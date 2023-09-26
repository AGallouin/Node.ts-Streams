import { Readable, Writable } from "stream";

type MergeValue<T extends Array<Stream<any>>> = T[number] extends Stream<infer R> ? R : never;

type ExtractValue<T extends Array<Stream<any>>> = {
  [P in keyof T]: T[P] extends Stream<infer R> ? R | undefined : never;
};

/**
 * A Stream<T> maintains an underlying instance of a node stream and provides usefull methods to
 * maniplulate its data painlessly.
 *
 * @access public
 */
export class Stream<T> {
  private readonly underlying: Readable;

  constructor() {
    this.underlying = new Readable({
      objectMode: true,
      read: () => {},
    });
  }

  public push(e: T) {
    this.underlying.push({ data: e });
  }

  public end() {
    this.underlying.push(null);
  }

  public emit(eventName: "error", paylaod: Error) {
    this.underlying.emit(eventName, paylaod);
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
        rStream.emit("error", e);
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
    const rStream = new Stream<T>();

    for (let i = 0; i < input.length; i++) {
      rStream.push(input[i]);
    }
    rStream.end();

    return rStream;
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

    let opennedStreams = arrayOfStreams.length;

    arrayOfStreams.map((stream) => {
      const wStream = new Writable({
        objectMode: true,
        write: (curr, _, next) => {
          rStream.push(curr.data);
          next();
        },
      });

      stream.underlying.on("error", (e) => {
        rStream.emit("error", e);
      });

      stream.underlying.pipe(wStream).on("finish", () => {
        opennedStreams--;
        if (opennedStreams === 0) {
          rStream.end();
          return;
        }
      });
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
    let opennedStreams = arrayOfStreams.length;

    const resetAndNext = () => {
      rStream.push(acc);
      acc = [] as any;
      accState = 0;
      const copy = nexts;
      nexts = [];
      copy.map((n) => n());
    };

    arrayOfStreams.map((stream, index) => {
      const wStream = new Writable({
        objectMode: true,
        write: (curr, _, next) => {
          acc[index] = curr.data;
          nexts.push(next);
          accState++;

          if (accState === opennedStreams) {
            resetAndNext();
          }
        },
      });

      stream.underlying.on("error", (e) => {
        rStream.emit("error", e);
      });

      stream.underlying.pipe(wStream).on("finish", () => {
        opennedStreams--;
        if (opennedStreams === 0) {
          rStream.end();
          return;
        }

        if (accState === opennedStreams) {
          resetAndNext();
        }
      });
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
   * @returns {Stream<O>}
   */
  map<O>(callbackfn: (value: T) => O | Promise<O>): Stream<O> {
    const rStream = new Stream<O>();
    const wStream = new Writable({
      objectMode: true,
      write: async (chunk, _, next) => {
        Promise.resolve()
          .then(() => callbackfn(chunk.data))
          .then((data) => {
            rStream.push(data);
            next();
          })
          .catch((e) => {
            rStream.emit("error", e);
            next();
          });
      },
    });

    this.underlying
      .on("error", (e) => {
        rStream.emit("error", e);
      })
      .pipe(wStream)
      .on("error", (e) => {
        rStream.emit("error", e);
      })
      .on("finish", () => {
        rStream.end();
      });

    return rStream;
  }

  /**
   * forEach<O>(f: (T) ⇒ O | Promise<O>): Stream<O>
   * Calls a defined callback function on each element of an Stream, and returns an Promise that resolves once all the forEach iterations have been processed.
   * The promise will throw if the callbackfn throws.
   *
   * @param {(value: T) => O | Promise<O>} callbackfn The method called at each iteration
   * @returns {Stream<O>}
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

    this.underlying.on("error", (e) => {
      rStream.emit("error", e);
    });

    this.addWritingStream((chunk, _, next) => {
      callbackfn(chunk)
        .addWritingStream((data, _, mNext) => {
          rStream.push(data);
          mNext();
        })
        .then(() => {
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
        rStream.emit("error", e);
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
      rStream.emit("error", e);
    });

    this.underlying.on("error", (e) => {
      rStream.emit("error", e);
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
   * @returns {Stream<T>}
   */
  filter(callbackfn: (value: T) => boolean): Stream<T> {
    const rStream = new Stream<T>();
    const wStream = new Writable({
      objectMode: true,
      write: async (chunk, _, next) => {
        try {
          if (callbackfn(chunk.data)) {
            rStream.push(chunk.data);
          }
          next();
        } catch (e) {
          rStream.emit("error", e as any);
        }
      },
    });

    this.underlying
      .on("error", (e) => {
        rStream.emit("error", e);
      })
      .pipe(wStream)
      .on("error", (e) => {
        rStream.emit("error", e);
      })
      .on("finish", () => {
        rStream.end();
      });

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

      this.underlying
        .on("error", (e) => {
          reject(e);
        })
        .pipe(wStream)
        .on("error", (e) => {
          reject(e);
        })
        .on("finish", () => {
          resolve(true);
        });
    });
  }

  /**
   * split(chunkSize: number): Stream<Array<T>>
   * Will accumulate a number of elements T and goupe them into an array of size chunkSize. If the Stream is exhaused before
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
        acc.push(curr);
        if (acc.length === nbElements) {
          rStream.push(acc);
          acc = [];
        }
        next();
      },
    });

    this.underlying.on("error", (e) => {
      rStream.emit("error", e);
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
      });

      this.underlying.pipe(wStream).on("finish", () => {
        resolve(acc);
      });
    });
  }
}
