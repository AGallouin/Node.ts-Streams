import { Stream } from "../streams";

test("consuming a Stream twice throws instead of silently returning nothing", async () => {
  const stream = Stream.FromArray([1, 2, 3]);

  expect(await stream.toArray()).toEqual([1, 2, 3]);
  expect(() => stream.toArray()).toThrow("already consumed");
});

test("flatMap on a consumed Stream throws without breaking the first consumer", async () => {
  const stream = Stream.FromArray([1, 2, 3]);
  const legit = stream.map((v) => v);

  expect(() => stream.flatMap((v) => Stream.FromArray([v]))).toThrow("already consumed");

  expect(await legit.toArray()).toEqual([1, 2, 3]);
});

test("chaining a transformation on a consumed Stream throws", async () => {
  const stream = Stream.FromArray([1, 2, 3]);
  await stream.toArray();

  expect(() => stream.map((v) => v)).toThrow("already consumed");
});

test("chaining two transformations on the same Stream throws", () => {
  const stream = Stream.FromArray([1, 2, 3]);
  stream.filter((v) => v > 1);

  expect(() => stream.map((v) => v)).toThrow("already consumed");
});

test("iterating a consumed Stream throws", async () => {
  expect.assertions(1);
  const stream = Stream.FromArray([1, 2, 3]);
  await stream.toArray();

  try {
    for await (const value of stream) {
      void value;
    }
  } catch (e) {
    expect((e as Error).message).toContain("already consumed");
  }
});
