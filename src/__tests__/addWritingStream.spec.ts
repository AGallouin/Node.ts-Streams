import { Stream } from "../streams";

import { Fixtures } from ".";

test("Add Writting Stream should handle errors in previous stream", async () => {
  expect.assertions(1);

  const stream = new Stream<Fixtures.DefaultStreamItem>(Fixtures.createDefaultObjectStream());

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
