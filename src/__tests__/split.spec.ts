import { Stream } from "../streams";

import { Fixtures } from ".";

test("Split must create chunks", async () => {
  expect.assertions(50);
  const stream = Fixtures.createDefaultObjectStream();

  await stream.split(2).addWritingStream((chunk, _, next) => {
    expect(chunk.length).toEqual(2);
    next();
  });
});

test("Split clamps invalid chunk sizes to 1 instead of buffering everything", async () => {
  expect(await Stream.FromArray([1, 2, 3]).split(0).toArray()).toEqual([[1], [2], [3]]);
  expect(await Stream.FromArray([1, 2, 3]).split(-5).toArray()).toEqual([[1], [2], [3]]);
  expect(await Stream.FromArray([1, 2, 3, 4]).split(2.7).toArray()).toEqual([
    [1, 2],
    [3, 4],
  ]);
});

test("Split chunks must contain the stream values", async () => {
  const res = await Stream.FromArray([1, 2, 3, 4, 5]).split(2).toArray();

  expect(res).toEqual([[1, 2], [3, 4], [5]]);
});

test("Split should pipe errors", async () => {
  expect.assertions(1);
  const stream = Stream.FromArray(Fixtures.createDefaultArray());

  try {
    await stream
      .map(() => {
        throw "This is an error";
      })
      .split(2)
      .toArray();
  } catch (err) {
    expect(err).toEqual("This is an error");
  }
});
