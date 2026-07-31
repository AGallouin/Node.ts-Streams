import { Stream } from "../streams";

import { Fixtures } from ".";

test("Add Writting Stream should handle errors in previous stream", async () => {
  expect.assertions(1);

  const stream = Fixtures.createDefaultObjectStream();

  try {
    await stream
      .map(() => {
        throw "This is an error";
      })
      .addWritingStream((_, __, next) => {
        next();
      });
  } catch (err) {
    expect(err).toEqual("This is an error");
  }
});

test("Add Writting Stream should handle errors thrown by writer function", async () => {
  expect.assertions(1);
  const stream = Stream.FromArray(Fixtures.createDefaultArray());

  try {
    await stream.addWritingStream((_, __, next) => {
      next(new Error("this is an error"));
    });
  } catch (e) {
    if (e instanceof Error) {
      expect(e.message).toEqual("this is an error");
    }
  }
});

test("Add Writting Stream should handle errors thrown in writer function", async () => {
  expect.assertions(1);
  const stream = Stream.FromArray(Fixtures.createDefaultArray());

  try {
    await stream.addWritingStream(() => {
      throw "this is an error";
    });
  } catch (e) {
    expect(e).toEqual("this is an error");
  }
});

test("Add Writting Stream surfaces an error thrown after next() was called", async () => {
  const stream = Stream.FromArray([1, 2, 3]);

  await expect(
    stream.addWritingStream((_, __, next) => {
      next();
      throw new Error("late error");
    })
  ).rejects.toThrow("late error");
});

test("Add Writting Stream surfaces a rejecting async callback", async () => {
  const stream = Stream.FromArray([1, 2, 3]);

  await expect(
    stream.addWritingStream(async () => {
      throw new Error("async error");
    })
  ).rejects.toThrow("async error");
});
