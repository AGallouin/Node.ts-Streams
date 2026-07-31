import { Stream } from "../streams";

import { Fixtures } from ".";

test("Stream can be consumed with for await...of", async () => {
  const stream = Fixtures.createDefaultNumberStream(0, 10);

  const res: number[] = [];
  for await (const value of stream) {
    res.push(value);
  }

  expect(res).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("for await...of can consume a chain of transformations", async () => {
  const stream = Stream.FromArray([1, 2, 3, 4]);

  const res: number[] = [];
  for await (const value of stream.map((e) => e * 10).filter((e) => e > 10)) {
    res.push(value);
  }

  expect(res).toEqual([20, 30, 40]);
});

test("for await...of throws when the stream errors", async () => {
  expect.assertions(1);
  const stream = Stream.FromPromise<number>(Promise.reject(new Error("This is an error")));

  try {
    for await (const _ of stream) {
      // should never yield
    }
  } catch (err) {
    expect((err as Error).message).toEqual("This is an error");
  }
});
