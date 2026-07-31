import { Fixtures } from ".";

import { setTimeout } from "timers/promises";

test("Foreach must iterate on data sync", async () => {
  expect.assertions(3);
  const stream = Fixtures.createDefaultObjectStream(0, 3);

  await stream.forEach((item, i) => {
    expect(item).toEqual({ id: i, info: `information::${i}` });
  });
});

test("Foreach must transform data Async", async () => {
  expect.assertions(4);
  const stream = Fixtures.createDefaultObjectStream(0, 3);
  let counter = 0;

  await stream.forEach(async (item) => {
    await setTimeout(100);
    expect(item).toEqual({ id: counter, info: `information::${counter}` });
    counter++;
  });

  expect(counter).toEqual(3);
});

test("Foreach must handle errors", async () => {
  expect.assertions(1);

  const stream = Fixtures.createDefaultObjectStream(0, 3);

  try {
    await stream.forEach(() => {
      throw "This is an error";
    });
  } catch (err) {
    expect(err).toEqual("This is an error");
  }
});
