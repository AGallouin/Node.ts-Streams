import { Stream } from "../streams";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("an error fired before any consumer attaches does not crash and is delivered on consumption", async () => {
  const stream = Stream.FromPromise<number>(Promise.reject(new Error("early error")));

  // The rejection fires here with no consumer attached: without the pending error
  // handling this would crash the process with an uncaught 'error' event.
  await sleep(50);

  await expect(stream.toArray()).rejects.toThrow("early error");
});

test("a pending error propagates through a chain attached later", async () => {
  const stream = Stream.FromPromise<number>(Promise.reject(new Error("early error")));

  await sleep(50);

  await expect(stream.map((v) => v * 2).toArray()).rejects.toThrow("early error");
});

test("for await...of throws a pending error", async () => {
  expect.assertions(2);
  const stream = Stream.FromPromise<number>(Promise.reject(new Error("early error")));

  await sleep(50);

  const seen: Array<number> = [];
  try {
    for await (const value of stream) {
      seen.push(value);
    }
  } catch (e) {
    expect((e as Error).message).toEqual("early error");
  }
  expect(seen).toEqual([]);
});

test("a falsy pending error reason is still delivered as an error", async () => {
  expect.assertions(1);
  const stream = Stream.FromPromise<number>(Promise.reject(""));

  await sleep(50);

  try {
    await stream.toArray();
  } catch (e) {
    expect((e as Error).message).toContain('Stream errored with: ');
  }
});

test("consuming a Stream destroyed beforehand rejects with a premature close error", async () => {
  const stream = Stream.FromArray([1, 2, 3]);
  stream.destroy();

  await expect(stream.toArray()).rejects.toThrow("Premature close");
});

test("emit('error') is terminal: consumption rejects even for errors fired before it", async () => {
  const stream = new Stream<number>();
  stream.push(1);
  stream.emit("error", new Error("manual error"));

  await expect(stream.toArray()).rejects.toThrow("manual error");
});

test("pushing after end() throws a clear synchronous error", () => {
  const stream = new Stream<number>();
  stream.push(1);
  stream.end();

  expect(() => stream.push(2)).toThrow("Cannot push after end()");
});

test("destroying a Stream mid-consumption rejects the consumer with a premature close", async () => {
  const stream = new Stream<number>();
  const result = stream.toArray();

  await stream.pushAsync(1);
  stream.destroy();

  await expect(result).rejects.toThrow("Premature close");
});

test("destroying a source mid-consumption rejects the consumer of a chain", async () => {
  const stream = new Stream<number>();
  const result = stream.map((v) => v * 2).toArray();

  await stream.pushAsync(1);
  stream.destroy();

  await expect(result).rejects.toThrow("Premature close");
});

test("destroying a Stream mid-forEach rejects the returned promise", async () => {
  const stream = new Stream<number>();
  const result = stream.forEach(() => {});

  await stream.pushAsync(1);
  stream.destroy();

  await expect(result).rejects.toThrow("Premature close");
});
