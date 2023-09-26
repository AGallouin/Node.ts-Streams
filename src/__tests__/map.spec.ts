import { Fixtures } from ".";

test("Map must transform data sync", async () => {
  expect.assertions(4);
  const stream = Fixtures.createDefaultObjectStream(0, 3);

  const res = await stream
    .map((data) => {
      return {
        ...data,
        id: "This is now a string",
      };
    })
    .addWritingStream((info, _, next) => {
      expect(info.id).toEqual("This is now a string");
      next();
    });

  expect(res).toEqual(true);
});

test("Map must transform data Async", async () => {
  expect.assertions(101);
  const stream = Fixtures.createDefaultObjectStream();

  const res = await stream
    .map((data) => {
      return Promise.resolve({
        ...data,
        id: "This is now a string",
      });
    })
    .addWritingStream((info, _, next) => {
      expect(info.id).toEqual("This is now a string");
      next();
    });

  expect(res).toEqual(true);
});

test("Map should handle errors", async () => {
  expect.assertions(1);

  const stream = Fixtures.createDefaultObjectStream();

  try {
    await stream
      .map(() => {
        throw "This is an error";
      })
      .toArray();
  } catch (err) {
    expect(err).toEqual("This is an error");
  }
});

test("Map should pipe errors", async () => {
  expect.assertions(1);
  const stream = Fixtures.createDefaultObjectStream();

  try {
    await stream
      .map(() => {
        throw "This is an error";
      })
      .map((e) => {
        return e;
      })
      .toArray();
  } catch (err) {
    expect(err).toEqual("This is an error");
  }
});
