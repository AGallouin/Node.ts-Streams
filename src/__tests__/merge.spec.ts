import { Stream } from "../streams";

import { Fixtures } from ".";

// The "terminates after a source error" tests cannot go through toArray()/forEach()
// because those reject on the first error event: the only observable signal left is
// the "close" event of the private underlying stream, emitted both on a normal end
// and on the error teardown.
function watchClose(stream: Stream<any>): Promise<boolean> {
  return new Promise((resolve) => {
    (stream as any).underlying.on("close", () => resolve(true));
    setTimeout(() => resolve(false), 500);
  });
}

test("Merge must merge all streams", async () => {
  const merged = Stream.Merge([
    Fixtures.createDefaultNumberStream(0, 10),
    Fixtures.createDefaultNumberStream(100, 10),
  ]);

  const res = await merged.toArray();

  expect(res.length).toEqual(20);
  expect(res.sort((a, b) => a - b)).toEqual([
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109,
  ]);
});

test("Merge should pipe errors", async () => {
  expect.assertions(1);
  const merged = Stream.Merge([
    Fixtures.createDefaultNumberStream(0, 10),
    Stream.FromPromise<number>(Promise.reject("This is an error")),
  ]);

  try {
    await merged.toArray();
  } catch (err) {
    expect(err).toEqual("This is an error");
  }
});

test("Merge should terminate even if a source stream errors", async () => {
  const merged = Stream.Merge([
    Fixtures.createDefaultNumberStream(0, 10),
    Stream.FromPromise<number>(Promise.reject("This is an error")),
  ]);
  const ended = watchClose(merged);

  await merged.toArray().catch(() => {});

  expect(await ended).toEqual(true);
});

test("MergeInOrder must group values by rank", async () => {
  const merged = Stream.MergeInOrder([
    Fixtures.createDefaultNumberStream(0, 3),
    Fixtures.createDefaultStringStream(0, 3),
  ]);

  const res = await merged.toArray();

  expect(res).toEqual([
    [0, "information::0"],
    [1, "information::1"],
    [2, "information::2"],
  ]);
});

test("Merge of an empty array ends immediately", async () => {
  expect(await Stream.Merge([]).toArray()).toEqual([]);
});

test("MergeInOrder of an empty array ends immediately", async () => {
  expect(await Stream.MergeInOrder([]).toArray()).toEqual([]);
});

test("Merge fails with a premature close when a source is destroyed directly", async () => {
  const a = new Stream<number>();
  const b = new Stream<number>();
  const merged = Stream.Merge([a, b]);
  const result = merged.toArray();

  await a.pushAsync(1);
  a.destroy();

  await expect(result).rejects.toThrow("Premature close");
});

test("MergeInOrder fails with a premature close when a source is destroyed directly", async () => {
  const a = new Stream<number>();
  const merged = Stream.MergeInOrder([a, Fixtures.createDefaultNumberStream(0, 3)]);
  const result = merged.toArray();

  a.destroy();

  await expect(result).rejects.toThrow("Premature close");
});

test("MergeInOrder pushes dense rows with an explicit undefined for exhausted sources", async () => {
  const merged = Stream.MergeInOrder([
    Fixtures.createDefaultNumberStream(0, 3),
    Fixtures.createDefaultStringStream(0, 1),
  ]);

  const res = await merged.toArray();

  expect(res).toEqual([
    [0, "information::0"],
    [1, undefined],
    [2, undefined],
  ]);
  // No array holes: every column must be a real own property of every row.
  expect(res.every((row) => row.length === 2 && 0 in row && 1 in row)).toBe(true);
});

test("Merge with an already consumed source throws without claiming the other sources", async () => {
  const consumed = Stream.FromArray([1]);
  await consumed.toArray();
  const fresh = Stream.FromArray([2]);

  expect(() => Stream.Merge([fresh, consumed])).toThrow("already consumed");

  // fresh must not have been claimed or wired by the failed merge
  expect(await fresh.toArray()).toEqual([2]);
});

test("MergeInOrder should terminate even if a source stream errors", async () => {
  const merged = Stream.MergeInOrder([
    Fixtures.createDefaultNumberStream(0, 3),
    Stream.FromPromise<number>(Promise.reject("This is an error")),
  ]);
  const ended = watchClose(merged);

  await merged.toArray().catch(() => {});

  expect(await ended).toEqual(true);
});
