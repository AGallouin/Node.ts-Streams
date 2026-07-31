import { Stream } from "../streams";

test("FromIterable must stream a sync iterable", async () => {
  function* generate() {
    yield 1;
    yield 2;
    yield 3;
  }

  const res = await Stream.FromIterable(generate()).toArray();

  expect(res).toEqual([1, 2, 3]);
});

test("FromIterable must stream an async iterable", async () => {
  async function* generate() {
    yield 1;
    await new Promise((resolve) => setTimeout(resolve, 1));
    yield 2;
  }

  const res = await Stream.FromIterable(generate()).toArray();

  expect(res).toEqual([1, 2]);
});

test("FromIterable should pipe errors", async () => {
  expect.assertions(1);

  async function* generate() {
    yield 1;
    throw new Error("This is an error");
  }

  try {
    await Stream.FromIterable(generate()).toArray();
  } catch (err) {
    expect((err as Error).message).toEqual("This is an error");
  }
});

test("FromIterable should apply backpressure to the producer", async () => {
  let produced = 0;

  function* generate() {
    for (let i = 0; i < 1000; i++) {
      produced++;
      yield i;
    }
  }

  const consumed: number[] = [];
  for await (const value of Stream.FromIterable(generate())) {
    consumed.push(value);
    if (consumed.length === 5) {
      break;
    }
  }

  expect(consumed).toEqual([0, 1, 2, 3, 4]);
  // Without backpressure the whole iterable would have been buffered eagerly.
  expect(produced).toBeLessThan(100);
});
