import { Stream } from "../streams";

import { Fixtures } from ".";
import { setTimeout } from "timers/promises";

test("Foreach must iterate on data sync", async () => {
  expect.assertions(4);
  const stream = new Stream<Fixtures.DefaultStreamItem>(Fixtures.createDefaultObjectStream(0, 3));

  const res = await stream.forEach((item, i) => {
    expect(item).toEqual({ id: i, info: `information::${i}` });
  });

  expect(res).toEqual(true);
});

test("Foreach must transform data Async", async () => {
  expect.assertions(5);
  const stream = new Stream<Fixtures.DefaultStreamItem>(Fixtures.createDefaultObjectStream(0, 3));
  let counter = 0;

  const res = await stream.forEach(async (item) => {
    await setTimeout(100);
    expect(item).toEqual({ id: counter, info: `information::${counter}` });
    counter++;
  });

  expect(res).toEqual(true);
  expect(counter).toEqual(3);
});

test("Foreach must handle errors", async () => {
  expect.assertions(1);

  const stream = new Stream<Fixtures.DefaultStreamItem>(Fixtures.createDefaultObjectStream(0, 3));

  try {
    await stream.forEach(() => {
      throw "This is an error";
    });
  } catch (err) {
    expect(err).toEqual("This is an error");
  }
});
