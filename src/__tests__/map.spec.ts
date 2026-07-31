import { Stream } from "../streams";

import { Fixtures } from ".";

test("Map must transform data sync", async () => {
  expect.assertions(3);
  const stream = Fixtures.createDefaultObjectStream(0, 3);

  await stream
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
});

test("Map must transform data Async", async () => {
  expect.assertions(100);
  const stream = Fixtures.createDefaultObjectStream();

  await stream
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

test("Map with concurrency does not fire an unhandled rejection on a fast failure", async () => {
  let unhandled = 0;
  const handler = () => {
    unhandled++;
  };
  process.on("unhandledRejection", handler);

  const res = await Stream.FromArray([1, 2, 3])
    .map(
      async (v) => {
        // v === 2 fails immediately while v === 1 is still pending: its rejection is
        // only awaited when the ordered output chain reaches it.
        if (v === 2) {
          throw new Error("fast failure");
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        return v;
      },
      { concurrency: 3 }
    )
    .toArray()
    .catch((e) => ({ err: (e as Error).message }));

  await new Promise((resolve) => setTimeout(resolve, 100));
  process.removeListener("unhandledRejection", handler);

  expect(res).toEqual({ err: "fast failure" });
  expect(unhandled).toEqual(0);
});

test("Map flattens promise return types even with an explicit type argument", async () => {
  const res = await Stream.FromArray([1, 2])
    .map<Promise<number>>((v) => Promise.resolve(v * 2))
    .toArray();

  // res is number[] both at the type level (Awaited<O>) and at runtime
  const doubled: Array<number> = res;
  expect(doubled).toEqual([2, 4]);
  expect(res.every((v) => typeof v === "number")).toBe(true);
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
