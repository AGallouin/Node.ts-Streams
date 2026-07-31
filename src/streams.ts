import { Readable, Writable } from "stream";

type MergeValue<T extends Array<Stream<any>>> = T[number] extends Stream<infer R> ? R : never;

type ExtractValue<T extends Array<Stream<any>>> = {
  [P in keyof T]: T[P] extends Stream<infer R> ? R | undefined : never;
};

/**
 * A Stream<T> maintains an underlying instance of a node stream and provides useful methods to
 * manipulate its data painlessly.
 *
 * @access public
 */
export class Stream<T> {
  private readonly underlying: Readable;
  private demandWaiters: Array<() => void> = [];

  constructor() {
    this.underlying = new Readable({
      objectMode: true,
      read: () => {
        this.releaseDemand();
      },
    });
    // A destroyed stream will never call read() again: release the pending
    // producers so they don't wait forever.
    this.underlying.on("close", () => {
      this.releaseDemand();
    });
  }

  private releaseDemand() {
    const waiters = this.demandWaiters;
    this.demandWaiters = [];
    waiters.forEach((resolve) => resolve());
  }

  /**
   * Pushes an element into the Stream.
   *
   * @returns {boolean} false when the internal buffer is full, ie. when the consumer is slower
   * than the producer. Pushing more elements is still possible but they will pile up in memory:
   * use pushAsync to honor backpressure instead.
   */
  public push(e: T): boolean {
    return this.underlying.push({ data: e });
  }

  /**
   * Pushes an element into the Stream and resolves once the Stream is ready to accept the
   * next one, applying backpressure when the consumer is slower than the producer.
   *
   * @returns {Promise<void>}
   */
  public async pushAsync(e: T): Promise<void> {
    if (this.underlying.destroyed) {
      return;
    }
    if (!this.push(e)) {
      await new Promise<void>((resolve) => {
        this.demandWaiters.push(resolve);
      });
    }
  }

  public end() {
    if (!this.underlying.destroyed) {
      this.underlying.push(null);
    }
  }

  /**
   * Destroys the Stream: pending producers are released and the production wired through
   * the library (FromIterable, transformations, ...) is stopped. Consuming a chain
   * partially (eg. breaking out of a for await...of loop) does this automatically.
   */
  public destroy() {
    this.underlying.destroy();
  }

  public emit(eventName: "error", payload: Error) {
    this.underlying.emit(eventName, payload);
  }

  // An emitted error is terminal: no consumer can observe elements pushed after it, so
  // the Stream is destroyed to stop the (potentially infinite) upstream production.
  private failWith(e: Error) {
    this.emit("error", e);
    this.destroy();
  }

  // When rStream closes (its consumer is gone, an error tore it down or it completed
  // normally), stop producing from this Stream. Destroying an already ended stream is a
  // no-op, so the normal completion case is unaffected.
  private propagateTeardown(rStream: Stream<any>) {
    rStream.underlying.on("close", () => {
      this.underlying.destroy();
    });
  }

  private pipeInto(rStream: Stream<any>, wStream: Writable) {
    this.propagateTeardown(rStream);
    this.underlying
      .on("error", (e) => {
        rStream.failWith(e);
      })
      .pipe(wStream)
      .on("error", (e) => {
        rStream.failWith(e);
      })
      .on("finish", () => {
        rStream.end();
      });
  }

  /**
   * Transforms Promise<T> into Stream<T>
   *
   * @param {Promise<T>} input Promise to transform
   * @returns {Stream<T>}
   */
  static FromPromise<T>(input: Promise<T>): Stream<T> {
    const rStream = new Stream<T>();

    input
      .then((data) => {
        rStream.push(data);
        rStream.end();
      })
      .catch((e) => {
        rStream.failWith(e);
      });

    return rStream;
  }

  /**
   * Transforms Array<T> into Stream<T>
   *
   * @param {Array<T>} input Array to transform
   * @returns {Stream<T>}
   */
  static FromArray<T>(input: Array<T>): Stream<T> {
    return Stream.FromIterable(input);
  }

  /**
   * Transforms Iterable<T> or AsyncIterable<T> (arrays, generators, async generators, ...)
   * into Stream<T>. The iterable is consumed lazily: elements are only pulled when the
   * Stream has room for them, applying backpressure to the producer.
   * Will push an error into the resulting Stream if the iterable throws.
   *
   * @param {Iterable<T> | AsyncIterable<T>} input Iterable to transform
   * @returns {Stream<T>}
   */
  static FromIterable<T>(input: Iterable<T> | AsyncIterable<T>): Stream<T> {
    const rStream = new Stream<T>();

    (async () => {
      try {
        for await (const value of input) {
          if (rStream.underlying.destroyed) {
            return;
          }
          await rStream.pushAsync(value);
        }
        rStream.end();
      } catch (e) {
        rStream.failWith(e as Error);
      }
    })();

    return rStream;
  }

  /**
   * Allows consuming the Stream with for await...of, honoring backpressure: elements are
   * only produced as fast as the loop consumes them.
   * The loop will throw if an error is emitted on the Stream.
   */
  async *[Symbol.asyncIterator](): AsyncIterableIterator<T> {
    for await (const chunk of this.underlying) {
      yield (chunk as { data: T }).data;
    }
  }

  /**
   * Merges [Stream<T>, Stream<U>, Stream<V>, ...] into Stream<T | U | V | ...>
   * It will exhaust when all streams are exhausted.
   *
   * @param {Stream<_>} arrayOfStreams Stream array
   * @returns {Stream<[_]>}
   */
  static Merge<T extends Array<Stream<any>>>(arrayOfStreams: T): Stream<MergeValue<T>> {
    const rStream = new Stream<MergeValue<T>>();

    let openedStreams = arrayOfStreams.length;

    arrayOfStreams.forEach((stream) => {
      // A source that errors never emits "finish", so it must be counted as
      // closed here or the merged stream would never end.
      let closed = false;
      const onClose = () => {
        if (closed) {
          return;
        }
        closed = true;
        openedStreams--;
        if (openedStreams === 0) {
          rStream.end();
        }
      };

      const wStream = new Writable({
        objectMode: true,
        write: (curr, _, next) => {
          rStream.pushAsync(curr.data).then(() => next());
        },
      });

      stream.propagateTeardown(rStream);
      stream.underlying.on("error", (e) => {
        rStream.failWith(e);
        onClose();
      });

      stream.underlying.pipe(wStream).on("finish", onClose);
    });

    return rStream;
  }

  /**
   * Merges [Stream<T>, Stream<U>, Stream<V>, ...] into Stream<[T, U, V, ...]>
   * It will pause until an instance of T, U, V, ... is provided until exhaustion of each ones.
   * ie. if Stream<U> is exhausted, it will push [T, undefined, V, ...]
   *
   * @param {Stream<_>} arrayOfStreams Stream array
   * @returns {Stream<[_]>}
   */
  static MergeInOrder<T extends [Stream<any>] | Array<Stream<any>>>(
    arrayOfStreams: T
  ): Stream<ExtractValue<T>> {
    const rStream = new Stream<ExtractValue<T>>();

    let acc: ExtractValue<T> = [] as any;
    let accState = 0;
    let nexts: Array<(error?: Error | null) => void> = [];
    let openedStreams = arrayOfStreams.length;

    const resetAndNext = () => {
      const toPush = acc;
      acc = [] as any;
      accState = 0;
      const copy = nexts;
      nexts = [];
      rStream.pushAsync(toPush).then(() => copy.forEach((n) => n()));
    };

    arrayOfStreams.forEach((stream, index) => {
      // A source that errors never emits "finish", so it must be counted as
      // closed here or the merged stream would never end.
      let closed = false;
      const onClose = () => {
        if (closed) {
          return;
        }
        closed = true;
        openedStreams--;
        if (openedStreams === 0) {
          rStream.end();
          return;
        }

        if (accState === openedStreams) {
          resetAndNext();
        }
      };

      const wStream = new Writable({
        objectMode: true,
        write: (curr, _, next) => {
          acc[index] = curr.data;
          nexts.push(next);
          accState++;

          if (accState === openedStreams) {
            resetAndNext();
          }
        },
      });

      stream.propagateTeardown(rStream);
      stream.underlying.on("error", (e) => {
        rStream.failWith(e);
        onClose();
      });

      stream.underlying.pipe(wStream).on("finish", onClose);
    });

    return rStream;
  }

  /**
   * map<O>(f: (T) ⇒ O | Promise<O>): Stream<O>
   * Calls a defined callback function on each element of an Stream, and returns an Stream that contains the results.
   * Will push an error in the resulting Stream if callbackfn throws.
   *
   * @param {(value: T) => O | Promise<O>} callbackfn The map method calls the callbackfn function one time for
   * each element in the stream. If this function returns a promise, it will wait for the promise resolution and push the
   * result in the resulting stream, keeping the order.
   * @param {{ concurrency?: number }} options concurrency is the maximum number of callbackfn calls allowed to run
   * at the same time (defaults to 1, ie. sequential). Whatever the concurrency, the output order always matches
   * the input order.
   * @returns {Stream<O>}
   */
  map<O>(callbackfn: (value: T) => O | Promise<O>, options?: { concurrency?: number }): Stream<O> {
    const concurrency = Math.max(1, Math.floor(options?.concurrency ?? 1));
    const rStream = new Stream<O>();

    let inFlight = 0;
    let releaseSlot: (() => void) | undefined;
    let outputChain: Promise<void> = Promise.resolve();

    const wStream = new Writable({
      objectMode: true,
      write: (chunk, _, next) => {
        const result = Promise.resolve().then(() => callbackfn(chunk.data));
        inFlight++;

        // Pushes are chained so the output order always matches the input order, even
        // when several callbacks run concurrently.
        outputChain = outputChain
          .then(() => result)
          .then((data) => rStream.pushAsync(data))
          .catch((e) => {
            rStream.failWith(e);
          })
          .then(() => {
            inFlight--;
            if (releaseSlot) {
              const release = releaseSlot;
              releaseSlot = undefined;
              release();
            }
          });

        if (inFlight < concurrency) {
          next();
        } else {
          new Promise<void>((resolve) => {
            releaseSlot = resolve;
          }).then(() => next());
        }
      },
      final: (done) => {
        outputChain.then(() => done());
      },
    });

    this.pipeInto(rStream, wStream);

    return rStream;
  }

  /**
   * forEach(f: (T, i: number) ⇒ void | Promise<void>): Promise<boolean>
   * Calls a defined callback function on each element of an Stream, and returns a Promise that resolves once all the forEach iterations have been processed.
   * The promise will reject if the callbackfn throws.
   *
   * @param {(value: T, i: number) => void | Promise<void>} callbackfn The method called at each iteration
   * @returns {Promise<boolean>}
   */
  async forEach(callbackfn: (value: T, i: number) => void | Promise<void>): Promise<boolean> {
    let counter = 0;
    return this.addWritingStream(async (value, _, next) => {
      try {
        await callbackfn(value, counter);
        counter++;
        next();
      } catch (e) {
        next(e as any);
      }
    });
  }

  /**
   * flatMap<O>(f: (T) ⇒ Stream<O>): Stream<O>
   * Calls a defined callback function on each element of an Stream, and exhaust the resulting Stream into the return stream before
   * calling next element.
   * Will push an error in the resulting Stream if callbackfn has an error.
   *
   * @param {(value: T) => Stream<O>} callbackfn The flatmap method calls the callbackfn function one time for
   * each element in the Stream.
   * @returns {Stream<O>}
   */
  flatMap<O>(callbackfn: (value: T) => Stream<O>): Stream<O> {
    const rStream = new Stream<O>();
    let currentInner: Stream<O> | undefined;

    this.propagateTeardown(rStream);
    // The inner stream being drained must be torn down too when the consumer goes away,
    // otherwise it would keep producing into the destroyed rStream.
    rStream.underlying.on("close", () => {
      currentInner?.destroy();
    });

    this.addWritingStream((chunk, _, next) => {
      const inner = callbackfn(chunk);
      currentInner = inner;
      inner
        .addWritingStream((data, _, mNext) => {
          rStream.pushAsync(data).then(() => mNext());
        })
        .then(() => {
          currentInner = undefined;
          next();
        })
        .catch((e) => {
          next(e);
        });
    })
      .then(() => {
        rStream.end();
      })
      .catch((e) => {
        rStream.failWith(e);
      });

    return rStream;
  }

  /**
   * reduce<O>(f: (O, T) ⇒ O, i: O): Stream<O>
   * Calls the specified callback function for all the elements in an Stream. The return value of the callback function is
   * the accumulated result, and is provided as an argument in the next call to the callback function.
   * Will push an error if callbackfn throws.
   *
   * @param {(acc: O, curr: T) => O} callbackfn The reduce method calls the callbackfn function one time
   * for each element in the array.
   * @param {(acc: O, curr: T) => O} initialValue Initial value to start the accumulation. The first call
   * to the callbackfn function provides this value as an argument.
   * @returns {Stream<O>}
   */
  reduce<O>(callbackfn: (acc: O, curr: T) => O, initialValue: O): Stream<O> {
    const rStream = new Stream<O>();

    let acc = initialValue;
    const wStream = new Writable({
      objectMode: true,
      write: (curr, _, next) => {
        try {
          acc = callbackfn(acc, curr.data);
          next();
        } catch (e) {
          next(e as any);
        }
      },
    }).on("error", (e) => {
      rStream.failWith(e);
    });

    this.propagateTeardown(rStream);
    this.underlying.on("error", (e) => {
      rStream.failWith(e);
    });

    this.underlying.pipe(wStream).on("finish", () => {
      rStream.push(acc);
      rStream.end();
    });

    return rStream;
  }

  /**
   * filter(f: (T) ⇒ boolean): Stream<T>
   * Returns the elements of an Stream that meet the condition specified in a callback function.
   * Will push an error if callbackfn throws.
   *
   * @param {(value: T) => boolean} callbackfn The filter method calls the predicate function one time for each element in the Stream.
   * A type guard predicate ((value: T) => value is S) narrows the resulting Stream to Stream<S>.
   * @returns {Stream<T>}
   */
  filter<S extends T>(callbackfn: (value: T) => value is S): Stream<S>;
  filter(callbackfn: (value: T) => boolean): Stream<T>;
  filter(callbackfn: (value: T) => boolean): Stream<T> {
    const rStream = new Stream<T>();
    const wStream = new Writable({
      objectMode: true,
      write: (chunk, _, next) => {
        try {
          if (callbackfn(chunk.data)) {
            rStream.pushAsync(chunk.data).then(() => next());
            return;
          }
          next();
        } catch (e) {
          rStream.failWith(e as any);
          next();
        }
      },
    });

    this.pipeInto(rStream, wStream);

    return rStream;
  }

  /**
   * Will pipe an Writing stream to the underlying stream. Resolves when the Stream is exhausted or rejects it if an
   * error has been encountered.
   * Will push an error if callbackfn throws.
   *
   * @param {(chunk: T, encoding: string, next: (error?: Error | null) => void) => void(value: T) => boolean} callbackfn
   * The addWritingStream method will call callbackfn one time for each element in Stream. The next function NEEDS to be called
   * to access the next element.
   * @returns {Promise<boolean>} Promise<true> will be return if all went well. If a Stream on the pipe has encountered an error or if
   * next() function has been called with an error as a param, it will reject the promise instead.
   */
  addWritingStream(
    callbackfn: (chunk: T, encoding: string, next: (error?: Error | null) => void) => void
  ): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const wStream = new Writable({
        objectMode: true,
        write: async (chunk, encoding, next) => {
          try {
            callbackfn(chunk.data, encoding, next);
          } catch (e) {
            next(e as any);
          }
        },
      });

      // The rejection is terminal for this consumer: destroy the source so the whole
      // upstream chain stops producing data nobody will ever read.
      const bail = (e: Error) => {
        reject(e);
        this.underlying.destroy();
      };

      this.underlying
        .on("error", bail)
        .pipe(wStream)
        .on("error", bail)
        .on("finish", () => {
          resolve(true);
        });
    });
  }

  /**
   * split(chunkSize: number): Stream<Array<T>>
   * Will accumulate a number of elements T and group them into an array of size chunkSize. If the Stream is exhausted before
   * chunkSize is reached, it will push the rest into a smaller array.
   * Should not throw, but should push an error into the resulting Stream if the input has one.
   *
   * @param {number} nbElements The desired size of the chunk
   * @returns {Stream<Array<T>>}
   */
  split(nbElements: number): Stream<Array<T>> {
    let acc: Array<T> = [];
    const rStream = new Stream<Array<T>>();

    const wStream = new Writable({
      objectMode: true,
      write: (curr, _, next) => {
        acc.push(curr.data);
        if (acc.length === nbElements) {
          const chunk = acc;
          acc = [];
          rStream.pushAsync(chunk).then(() => next());
          return;
        }
        next();
      },
    });

    this.propagateTeardown(rStream);
    this.underlying.on("error", (e) => {
      rStream.failWith(e);
    });

    this.underlying.pipe(wStream).on("finish", () => {
      if (acc.length > 0) {
        rStream.push(acc);
      }
      rStream.end();
    });

    return rStream;
  }

  /**
   * toArray(): Promise<Array<T>>
   * Will exhaust the current Stream<T> into an Array<T> and resolves its promise when it's done. If an error is found in the
   * underlying stream, rejects the promise instead.
   *
   * @returns {Promise<Array<T>>}
   */
  toArray(): Promise<Array<T>> {
    return new Promise((resolve, reject) => {
      const acc: Array<T> = [];
      const wStream = new Writable({
        objectMode: true,
        write: (curr, _, next) => {
          acc.push(curr.data);
          next();
        },
      });

      this.underlying.on("error", (e) => {
        reject(e);
        // The rejection is terminal: destroy the source so the whole upstream chain
        // stops producing (and accumulating) data nobody will ever read.
        this.underlying.destroy();
      });

      this.underlying.pipe(wStream).on("finish", () => {
        resolve(acc);
      });
    });
  }
}
