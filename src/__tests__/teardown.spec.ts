import { Stream } from "../streams";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A source that counts how many elements the pipeline actually pulled from it.
function countingSource(length = 1000) {
  const state = { produced: 0 };

  async function* generate() {
    for (let i = 0; i < length; i++) {
      state.produced++;
      yield i;
    }
  }

  return { state, stream: Stream.FromIterable(generate()) };
}

test("breaking out of for await...of stops the upstream production", async () => {
  const { state, stream } = countingSource();

  const consumed: number[] = [];
  for await (const value of stream.map((v) => v)) {
    consumed.push(value);
    if (consumed.length === 5) {
      break;
    }
  }

  await sleep(100);
  expect(consumed).toEqual([0, 1, 2, 3, 4]);
  expect(state.produced).toBeLessThan(100);
});

test("a rejected consumer stops the upstream production", async () => {
  expect.assertions(2);
  const { state, stream } = countingSource();

  try {
    await stream
      .map((v) => {
        if (v === 5) {
          throw "This is an error";
        }
        return v;
      })
      .toArray();
  } catch (err) {
    expect(err).toEqual("This is an error");
  }

  await sleep(100);
  expect(state.produced).toBeLessThan(100);
});

test("destroy() stops the upstream production", async () => {
  const { state, stream } = countingSource();
  const mapped = stream.map((v) => v);

  const iterator = mapped[Symbol.asyncIterator]();
  await iterator.next();
  mapped.destroy();

  await sleep(100);
  expect(state.produced).toBeLessThan(100);
});

test("breaking out stops an in-flight flatMap inner stream", async () => {
  const inner = countingSource();

  const consumed: number[] = [];
  for await (const value of Stream.FromArray([1]).flatMap(() => inner.stream)) {
    consumed.push(value);
    if (consumed.length === 3) {
      break;
    }
  }

  await sleep(100);
  expect(consumed).toEqual([0, 1, 2]);
  expect(inner.state.produced).toBeLessThan(100);
});

test("teardown does not pull an extra element from the source iterable", async () => {
  let pulled = 0;
  function* source() {
    while (true) {
      pulled++;
      yield pulled;
    }
  }

  const stream = Stream.FromIterable(source());
  const iterator = stream[Symbol.asyncIterator]();
  await iterator.next();

  const before = pulled;
  stream.destroy();
  await sleep(100);

  // Sources with side effects per pull (DB cursors, paginated APIs) must not be
  // pulled again once the teardown released the pending pushAsync.
  expect(pulled).toEqual(before);
});

test("an error tears down all the sources of a Merge", async () => {
  const source = countingSource();
  const merged = Stream.Merge([
    source.stream,
    Stream.FromPromise<number>(Promise.reject("This is an error")),
  ]);

  await merged.toArray().catch(() => {});

  await sleep(100);
  expect(source.state.produced).toBeLessThan(1000);
});
