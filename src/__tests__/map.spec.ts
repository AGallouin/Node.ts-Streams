import { Stream } from "../streams";

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

test("Map must run callbacks concurrently while keeping the output order", async () => {
  const stream = Stream.FromArray([50, 10, 30, 0, 20]);
  let inFlight = 0;
  let maxInFlight = 0;

  const res = await stream
    .map(
      async (delay) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, delay));
        inFlight--;
        return delay;
      },
      { concurrency: 3 }
    )
    .toArray();

  expect(res).toEqual([50, 10, 30, 0, 20]);
  expect(maxInFlight).toBeGreaterThan(1);
  expect(maxInFlight).toBeLessThanOrEqual(3);
});

test("Map should pipe errors when running concurrently", async () => {
  expect.assertions(1);

  try {
    await Stream.FromArray([1, 2, 3])
      .map(
        async (v) => {
          if (v === 2) {
            throw "This is an error";
          }
          return v;
        },
        { concurrency: 2 }
      )
      .toArray();
  } catch (err) {
    expect(err).toEqual("This is an error");
  }
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
