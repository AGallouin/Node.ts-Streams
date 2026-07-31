import { Stream } from "../streams";

import { Fixtures } from ".";

test("Filter must work", async () => {
  expect.assertions(50);
  const stream = Stream.FromArray(Fixtures.createDefaultArray());

  const resArray = await stream.filter((e) => e.id > 50).toArray();

  expect(resArray.length).toEqual(49);

  for (let i = 0; i < resArray.length; i++) {
    expect(resArray[i].info).toEqual(`information::${i + 51}`);
  }
});

test("Filter should handle error", async () => {
  expect.assertions(1);

  const stream = Stream.FromArray(Fixtures.createDefaultArray());

  try {
    await stream
      .filter(() => {
        throw "This is an error";
      })
      .toArray();
  } catch (err) {
    expect(err).toEqual("This is an error");
  }
});

test("Filter should narrow types with a type guard", async () => {
  const stream = Stream.FromArray<number | null>([1, null, 2, null, 3]);

  const res: number[] = await stream.filter((e): e is number => e !== null).toArray();

  expect(res).toEqual([1, 2, 3]);
});

test("Filter should stop the pipeline after a throwing element", async () => {
  expect.assertions(2);
  let calls = 0;

  async function* generate() {
    for (let i = 0; i < 1000; i++) {
      yield i;
    }
  }

  try {
    await Stream.FromIterable(generate())
      .filter((v) => {
        calls++;
        if (v === 5) {
          throw "This is an error";
        }
        return true;
      })
      .toArray();
  } catch (err) {
    expect(err).toEqual("This is an error");
  }

  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(calls).toBeLessThan(1000);
});

test("Filter should pipe errors", async () => {
  expect.assertions(1);
  const stream = Stream.FromArray(Fixtures.createDefaultArray());

  try {
    await stream
      .map(() => {
        throw "This is an error";
      })
      .filter(() => true)
      .toArray();
  } catch (err) {
    expect(err).toEqual("This is an error");
  }
});
