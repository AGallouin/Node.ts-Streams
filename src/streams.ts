import { Readable, Transform, Writable } from "stream";

/**
 * A Stream<T> maintains an underlying instance of a node stream and provides usefull methods to
 * maniplulate its data painlessly.
 *
 * @access public
 */
export class Stream<T> {
  private readonly underlying: Readable;

  /**
   * If you have a Readable stream you want to wrap into a Stream, use this method. A Node JS
   * @constructor
   * @param {Readable} stream Typescript cannot infer the type of the stream data automatically,
   * so for readability (an avoid an any), explicitly specify the type of the data.
   * ie. new Stream<number>(nodeJsNativeStream)
   */
  constructor(stream: Readable) {
    this.underlying = stream;
  }

  /**
   * Transforms Promise<T> into Stream<T>
   *
   * @param {Promise<T>} input Promise to transform
   * @returns {Stream<T>}
   */
  static FromPromise<T>(input: Promise<T>): Stream<T> {
    const rStream = new Readable({
      objectMode: true,
      read: () => {},
    });

    input
      .then((data) => {
        rStream.push(data);
        rStream.push(null);
      })
      .catch((e) => {
        rStream.emit("error", e);
      });

    return new Stream<T>(rStream);
  }

  /**
   * Transforms Array<T> into Stream<T>
   *
   * @param {Array<T>} input Array to transform
   * @returns {Stream<T>}
   */
  static FromArray<T>(input: Array<T>): Stream<T> {
    const rStream = new Readable({
      objectMode: true,
      read: () => {},
    });

    for (let i = 0; i < input.length; i++) {
      rStream.push(input[i]);
    }
    rStream.push(null);

    return new Stream<T>(rStream);
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
    const rStream = new Readable({
      objectMode: true,
      read: () => {},
    });

    const wStream = new Writable({
      objectMode: true,
      write: async (chunk, _, next) => {
        Promise.resolve()
          .then(() => callbackfn(chunk))
          .then((v) => {
            rStream.push(v);
            next();
          })
          .catch((e) => {
            next(e);
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
        rStream.push(null);
      });

    return new Stream<O>(rStream);
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
    const rStream = new Readable({
      objectMode: true,
      read: () => {},
    });

    const wStream = new Writable({
      objectMode: true,
      write: (chunk, _, next) => {
        callbackfn(chunk)
          .addWritingStream((mChunk, _, mNext) => {
            rStream.push(mChunk);
            mNext();
          })
          .then(() => {
            next();
          })
          .catch((e) => {
            next(e);
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
        rStream.push(null);
      });

    return new Stream<O>(rStream);
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
    const rStream = new Readable({
      objectMode: true,
      read: () => {},
    });

    let acc = initialValue;
    const wStream = new Writable({
      objectMode: true,
      write: (curr, _, next) => {
        try {
          acc = callbackfn(acc, curr);
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
      rStream.push(null);
    });

    return new Stream<O>(rStream);
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
    const tStream = new Transform({
      objectMode: true,
      transform: (data, _, callback) => {
        try {
          if (callbackfn(data)) {
            callback(undefined, data);
          } else {
            callback();
          }
        } catch (e) {
          callback(e as any);
        }
      },
    });

    this.underlying.on("error", (e) => {
      tStream.emit("error", e);
    });

    this.underlying.pipe(tStream);

    return new Stream<T>(tStream);
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
            callbackfn(chunk, encoding, next);
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
    const rStream = new Readable({
      objectMode: true,
      read: () => {},
    });

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
      rStream.push(null);
    });

    return new Stream<Array<T>>(rStream);
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
          acc.push(curr);
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
