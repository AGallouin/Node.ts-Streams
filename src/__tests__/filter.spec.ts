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
