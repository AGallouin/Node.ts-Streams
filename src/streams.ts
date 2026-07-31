import { Readable, Writable } from "stream";

type MergeValue<T extends Array<Stream<any>>> = T[number] extends Stream<infer R> ? R : never;

type ExtractValue<T extends Array<Stream<any>>> = {
  [P in keyof T]: T[P] extends Stream<infer R> ? R | undefined : never;
};

/**
 * A Stream<T> maintains an underlying instance of a node stream and provides useful methods to
 * manipulate its data painlessly.
 *
 * A Stream can only be consumed once: chaining a transformation (map, filter, ...) or a
 * terminal operation (toArray, forEach, for await...of, ...) claims it. Consuming it a second
 * time throws synchronously instead of silently producing no data.
 *
 * @access public
 */
export class Stream<T> {
  private readonly underlying: Readable;
  private demandWaiters: Array<() => void> = [];
  private pendingError: Error | undefined;
  // pendingError alone cannot flag failure: at runtime errors can be any thrown value,
  // including falsy ones ("", 0, undefined).
  private errored = false;
  private ended = false;
  private consumed = false;

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
    // A Stream can error before its consumer attaches (eg. FromPromise of an already
    // rejected promise). Without a listener Node turns the 'error' event into an uncaught
    // exception: keep the error instead, consumption delivers it later.
    this.underlying.on("error", (e) => {
      if (!this.errored) {
        this.errored = true;
        this.pendingError = e;
      }
    });
  }

  private releaseDemand() {
    const waiters = this.demandWaiters;
    this.demandWaiters = [];
    waiters.forEach((resolve) => resolve());
  }

  private assertNotConsumed() {
    if (this.consumed) {
      throw new Error(
        "Stream already consumed: a Stream can only be consumed once (by a transformation, toArray, forEach, for await...of, ...)"
      );
    }
  }

  // Claims the Stream for its unique consumer. Throws synchronously on a second
  // consumption. Returns the error to deliver to the consumer when the Stream is
  // already dead (errored, or destroyed before consumption).
  private claimForConsumption(): Error | undefined {
    this.assertNotConsumed();
    this.consumed = true;
    if (this.errored) {
      // Falsy thrown values are wrapped so every caller can rely on the returned
      // error being truthy.
      return this.pendingError || new Error(`Stream errored with: ${String(this.pendingError)}`);
    }
    if (this.underlying.destroyed) {
      return new Error("Premature close: the Stream was destroyed before being consumed");
    }
    return undefined;
  }

  private prematureClose(): Error {
    return new Error("Premature close: the Stream was destroyed while being consumed");
  }

  /**
   * Pushes an element into the Stream. Throws if the Stream was already ended.
   *
   * @returns {boolean} false when the internal buffer is full, ie. when the consumer is slower
   * than the producer. Pushing more elements is still possible but they will pile up in memory:
   * use pushAsync to honor backpressure instead.
   */
  public push(e: T): boolean {
    if (this.ended) {
      throw new Error("Cannot push after end(): the Stream no longer accepts new elements");
    }
    return this.underlying.push({ data: e });
  }

  /**
   * Pushes an element into the Stream and resolves once the Stream is ready to accept the
   * next one, applying backpressure when the consumer is slower than the producer.
   * Rejects if the Stream was already ended.
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
    if (this.ended || this.underlying.destroyed) {
      return;
    }
    this.ended = true;
    this.underlying.push(null);
  }

  /**
   * Destroys the Stream: pending producers are released, the production wired through
   * the library (FromIterable, transformations, ...) is stopped and any pending consumer
   * is rejected with a premature close error. Consuming a chain partially (eg. breaking
   * out of a for await...of loop) does this automatically.
   * To complete a Stream early but gracefully, use end() instead.
   */
  public destroy() {
    this.underlying.destroy();
  }

  /**
   * Emits an error on the Stream. An emitted error is terminal: it is delivered to the
   * consumer (toArray/forEach reject, for await...of throws) and the Stream is destroyed,
   * so no element pushed afterwards can be observed and upstream production stops.
   */
  public emit(eventName: "error", payload: Error) {
    this.underlying.emit(eventName, payload);
    this.destroy();
  }

  private failWith(e: Error) {
    this.emit("error", e);
  }

  // When rStream closes (its consumer is gone, an error tore it down or it completed
  // normally), stop producing from this Stream. Destroying an already ended stream is a
  // no-op, so the normal completion case is unaffected.
  private propagateTeardown(rStream: Stream<any>) {
    if (rStream.underlying.destroyed) {
      this.underlying.destroy();
      return;
    }
    rStream.underlying.on("close", () => {
      this.underlying.destroy();
    });
  }

  private pipeInto(
    rStream: Stream<any>,
    wStream: Writable,
    onFinish: () => void = () => rStream.end()
  ) {
    const pending = this.claimForConsumption();
    this.propagateTeardown(rStream);
    if (pending) {
      rStream.failWith(pending);
      return;
    }
    // destroy() without an error emits neither 'error' nor 'end': surface it as a
    // premature close instead of leaving the pipeline silently stuck forever.
    this.underlying.on("close", () => {
      if (!this.underlying.readableEnded && !this.errored) {
        rStream.failWith(this.prematureClose());
      }
    });
    this.underlying
      .on("error", (e) => {
        rStream.failWith(e);
      })
      .pipe(wStream)
      .on("error", (e) => {
        rStream.failWith(e);
      })
      .on("finish", onFinish);
  }

  // Wires this (already claimed) Stream into a writing callback. Resolves when the Stream
  // is exhausted, rejects when it errors or is destroyed mid-consumption.
  private writeInto(
    callbackfn: (chunk: T, encoding: BufferEncoding, next: (error?: Error | null) => void) => void
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const wStream = new Writable({
        objectMode: true,
        write: (chunk, encoding, next) => {
          // next must only reach the stream machinery once: a callback that calls it and
          // then throws would otherwise crash with "Callback called multiple times".
          let called = false;
          const nextOnce = (error?: Error | null) => {
            if (called) {
              return;
            }
            called = true;
            next(error);
          };
          const failLate = (e: Error) => {
            if (called) {
              wStream.destroy(e);
              return;
            }
            nextOnce(e);
          };

          let result: unknown;
          try {
            result = callbackfn(chunk.data, encoding, nextOnce);
          } catch (e) {
            failLate(e as Error);
            return;
          }
          // A rejected promise returned by an async callback would otherwise be an
          // unhandled rejection: route it into the error flow instead.
          if (result instanceof Promise) {
            result.catch((e) => {
              failLate(e as Error);
            });
          }
        },
      });

      // The rejection is terminal for this consumer: destroy the source so the whole
      // upstream chain stops producing data nobody will ever read.
      const bail = (e: Error) => {
        reject(e);
        this.underlying.destroy();
      };

      // destroy() without an error emits neither 'error' nor 'end': surface it as a
      // premature close instead of leaving the promise pending forever.
      this.underlying.on("close", () => {
        if (!this.underlying.readableEnded && !this.errored) {
          bail(this.prematureClose());
        }
      });

      this.underlying
        .on("error", bail)
        .pipe(wStream)
        .on("error", bail)
        .on("finish", () => {
          resolve();
        });
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
          // Checked again after the await: on teardown, returning here (instead of at
          // the loop head) avoids pulling one extra element from a source with side
          // effects per pull (DB cursor, paginated API, ...).
          if (rStream.underlying.destroyed) {
            return;
          }
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
  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    const pending = this.claimForConsumption();
    const underlying = this.underlying;
    return (async function* () {
      if (pending) {
        throw pending;
      }
      for await (const chunk of underlying) {
        yield (chunk as { data: T }).data;
      }
    })();
  }

  /**
   * Merges [Stream<T>, Stream<U>, Stream<V>, ...] into Stream<T | U | V | ...>
   * It will exhaust when all streams are exhausted.
   *
   * @param {Array<Stream<any>>} arrayOfStreams Stream array
   * @returns {Stream<T | U | V | ...>}
   */
  static Merge<T extends Array<Stream<any>>>(arrayOfStreams: T): Stream<MergeValue<T>> {
    // Fail fast before any source is claimed or wired: a merge that throws halfway
    // through would leave the earlier sources piped into an abandoned stream.
    arrayOfStreams.forEach((stream) => stream.assertNotConsumed());

    const rStream = new Stream<MergeValue<T>>();

    let openedStreams = arrayOfStreams.length;

    if (openedStreams === 0) {
      rStream.end();
      return rStream;
    }

    arrayOfStreams.forEach((stream) => {
      // A source that errors or is destroyed never emits "finish", so it must be
      // counted as closed here or the merged stream would never end.
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

      const pending = stream.claimForConsumption();
      stream.propagateTeardown(rStream);
      if (pending) {
        rStream.failWith(pending);
        onClose();
        return;
      }

      stream.underlying.on("error", (e) => {
        rStream.failWith(e);
        onClose();
      });
      // A source destroyed without ending is premature: fail the merge like any other
      // consumer would (end() is the graceful way to complete a source early).
      stream.underlying.on("close", () => {
        if (!stream.underlying.readableEnded && !stream.errored) {
          rStream.failWith(new Error("Premature close: a source Stream of a Merge was destroyed"));
          onClose();
        }
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
   * @param {Array<Stream<any>>} arrayOfStreams Stream array
   * @returns {Stream<[T, U, V, ...]>}
   */
  static MergeInOrder<T extends [Stream<any>] | Array<Stream<any>>>(
    arrayOfStreams: T
  ): Stream<ExtractValue<T>> {
    // Fail fast before any source is claimed or wired: a merge that throws halfway
    // through would leave the earlier sources piped into an abandoned stream.
    arrayOfStreams.forEach((stream) => stream.assertNotConsumed());

    const rStream = new Stream<ExtractValue<T>>();

    const streamCount = arrayOfStreams.length;
    // Rows are seeded dense so exhausted sources contribute a real undefined instead of
    // an array hole (holes are skipped by map/forEach and fail the `in` operator).
    const denseRow = () => new Array(streamCount).fill(undefined) as ExtractValue<T>;
    let acc: ExtractValue<T> = denseRow();
    let accState = 0;
    let nexts: Array<(error?: Error | null) => void> = [];
    let openedStreams = streamCount;

    if (openedStreams === 0) {
      rStream.end();
      return rStream;
    }

    const resetAndNext = () => {
      const toPush = acc;
      acc = denseRow();
      accState = 0;
      const copy = nexts;
      nexts = [];
      rStream.pushAsync(toPush).then(() => copy.forEach((n) => n()));
    };

    arrayOfStreams.forEach((stream, index) => {
      // A source that errors or is destroyed never emits "finish", so it must be
      // counted as closed here or the merged stream would never end.
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

      const pending = stream.claimForConsumption();
      stream.propagateTeardown(rStream);
      if (pending) {
        rStream.failWith(pending);
        onClose();
        return;
      }

      stream.underlying.on("error", (e) => {
        rStream.failWith(e);
        onClose();
      });
      // A source destroyed without ending is premature: fail the merge like any other
      // consumer would (end() is the graceful way to complete a source early).
      stream.underlying.on("close", () => {
        if (!stream.underlying.readableEnded && !stream.errored) {
          rStream.failWith(new Error("Premature close: a source Stream of a Merge was destroyed"));
          onClose();
        }
      });

      stream.underlying.pipe(wStream).on("finish", onClose);
    });

    return rStream;
  }

  /**
   * map<O>(f: (T) ⇒ O | Promise<O>): Stream<Awaited<O>>
   * Calls a defined callback function on each element of the Stream, and returns a Stream that
   * contains the results. Promise results are always awaited before being pushed, hence the
   * Awaited<O> element type.
   * Will push an error in the resulting Stream if callbackfn throws.
   *
   * @param {(value: T) => O | Promise<O>} callbackfn The map method calls the callbackfn function one time for
   * each element in the stream. If this function returns a promise, it will wait for the promise resolution and push the
   * result in the resulting stream, keeping the order.
   * @param {{ concurrency?: number }} options concurrency is the maximum number of callbackfn calls allowed to run
   * at the same time (defaults to 1, ie. sequential). Whatever the concurrency, the output order always matches
   * the input order.
   * @returns {Stream<Awaited<O>>}
   */
  map<O>(
    callbackfn: (value: T) => O | Promise<O>,
    options?: { concurrency?: number }
  ): Stream<Awaited<O>> {
    const concurrency = Math.max(1, Math.floor(options?.concurrency ?? 1));
    const rStream = new Stream<Awaited<O>>();

    let inFlight = 0;
    let releaseSlot: (() => void) | undefined;
    let outputChain: Promise<void> = Promise.resolve();

    const wStream = new Writable({
      objectMode: true,
      write: (chunk, _, next) => {
        const result = Promise.resolve().then(() => callbackfn(chunk.data));
        // The rejection is handled when outputChain reaches this element; observe it
        // here too so a fast failure parked behind a slower predecessor is not reported
        // as an unhandled rejection (which crashes the process by default).
        result.catch(() => {});
        inFlight++;

        // Pushes are chained so the output order always matches the input order, even
        // when several callbacks run concurrently.
        outputChain = outputChain
          .then(() => result)
          .then((data) => rStream.pushAsync(data as Awaited<O>))
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
   * forEach(f: (T, i: number) ⇒ void | Promise<void>): Promise<void>
   * Calls a defined callback function on each element of the Stream, and returns a Promise that
   * resolves once all the forEach iterations have been processed.
   * The promise will reject if the callbackfn throws.
   *
   * @param {(value: T, i: number) => void | Promise<void>} callbackfn The method called at each iteration
   * @returns {Promise<void>}
   */
  async forEach(callbackfn: (value: T, i: number) => void | Promise<void>): Promise<void> {
    let counter = 0;
    return this.addWritingStream(async (value, _, next) => {
      try {
        await callbackfn(value, counter);
        counter++;
        next();
      } catch (e) {
        next(e as Error);
      }
    });
  }

  /**
   * flatMap<O>(f: (T) ⇒ Stream<O>): Stream<O>
   * Calls a defined callback function on each element of the Stream, and exhausts the resulting
   * Stream into the return stream before calling the next element.
   * Will push an error in the resulting Stream if callbackfn has an error.
   *
   * @param {(value: T) => Stream<O>} callbackfn The flatmap method calls the callbackfn function one time for
   * each element in the Stream.
   * @returns {Stream<O>}
   */
  flatMap<O>(callbackfn: (value: T) => Stream<O>): Stream<O> {
    const rStream = new Stream<O>();
    const pending = this.claimForConsumption();
    this.propagateTeardown(rStream);
    if (pending) {
      rStream.failWith(pending);
      return rStream;
    }

    let currentInner: Stream<O> | undefined;

    // The inner stream being drained must be torn down too when the consumer goes away,
    // otherwise it would keep producing into the destroyed rStream.
    rStream.underlying.on("close", () => {
      currentInner?.destroy();
    });

    this.writeInto((chunk, _, next) => {
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
   * Calls the specified callback function for all the elements in the Stream. The return value of
   * the callback function is the accumulated result, and is provided as an argument in the next
   * call to the callback function.
   * Will push an error if callbackfn throws.
   *
   * @param {(acc: O, curr: T) => O} callbackfn The reduce method calls the callbackfn function one time
   * for each element in the Stream.
   * @param {O} initialValue Initial value to start the accumulation. The first call
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
          next(e as Error);
        }
      },
    });

    this.pipeInto(rStream, wStream, () => {
      rStream.push(acc);
      rStream.end();
    });

    return rStream;
  }

  /**
   * filter(f: (T) ⇒ boolean): Stream<T>
   * Returns the elements of the Stream that meet the condition specified in a callback function.
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
          next(e as Error);
        }
      },
    });

    this.pipeInto(rStream, wStream);

    return rStream;
  }

  /**
   * Pipes a writing function at the end of the Stream. Resolves when the Stream is exhausted,
   * rejects when an error is encountered in the Stream or reported by callbackfn.
   *
   * @param {(chunk: T, encoding: BufferEncoding, next: (error?: Error | null) => void) => void} callbackfn
   * The addWritingStream method will call callbackfn one time for each element in the Stream. The
   * next function NEEDS to be called to access the next element; calling it with an error stops
   * the Stream and rejects the returned promise.
   * @returns {Promise<void>} Resolves once the Stream is exhausted. If a Stream on the pipe has
   * encountered an error or if the next() function has been called with an error as a param, it
   * will reject the promise instead.
   */
  addWritingStream(
    callbackfn: (chunk: T, encoding: BufferEncoding, next: (error?: Error | null) => void) => void
  ): Promise<void> {
    const pending = this.claimForConsumption();
    if (pending) {
      return Promise.reject(pending);
    }
    return this.writeInto(callbackfn);
  }

  /**
   * split(chunkSize: number): Stream<Array<T>>
   * Will accumulate a number of elements T and group them into an array of size chunkSize. If the Stream is exhausted before
   * chunkSize is reached, it will push the rest into a smaller array.
   * Should not throw, but should push an error into the resulting Stream if the input has one.
   *
   * @param {number} nbElements The desired size of the chunk (clamped to an integer >= 1)
   * @returns {Stream<Array<T>>}
   */
  split(nbElements: number): Stream<Array<T>> {
    // Guards against sizes that could never match acc.length (0, negatives, floats, NaN)
    // and would silently buffer the whole stream into a single array.
    const chunkSize = Number.isFinite(nbElements) && nbElements >= 1 ? Math.floor(nbElements) : 1;
    let acc: Array<T> = [];
    const rStream = new Stream<Array<T>>();

    const wStream = new Writable({
      objectMode: true,
      write: (curr, _, next) => {
        acc.push(curr.data);
        if (acc.length === chunkSize) {
          const chunk = acc;
          acc = [];
          rStream.pushAsync(chunk).then(() => next());
          return;
        }
        next();
      },
    });

    this.pipeInto(rStream, wStream, () => {
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
    const pending = this.claimForConsumption();
    if (pending) {
      return Promise.reject(pending);
    }

    const acc: Array<T> = [];
    return this.writeInto((chunk, _, next) => {
      acc.push(chunk);
      next();
    }).then(() => acc);
  }
}
