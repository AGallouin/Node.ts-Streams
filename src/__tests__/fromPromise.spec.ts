import { Stream } from "../streams";
import { dataFixture } from "./fixtures";

test("From Promise must handle a Promise", async () => {
  expect.assertions(1);

  const promiseFixture = new Promise<typeof dataFixture>((resolve) => {
    setTimeout(() => {
      resolve(dataFixture);
    }, 1000);
  });

  const res = await Stream.FromPromise(promiseFixture)
    .map((data) => {
      return {
        ...data,
        mappedData: "mappedData",
      };
    })
    .toArray();

  expect(res).toEqual([
    {
      ...dataFixture,
      mappedData: "mappedData",
    },
  ]);
});

test("From promise should handle errors", async () => {
  expect.assertions(1);

  const promiseFixture = Promise.resolve().then<typeof dataFixture>(() => {
    throw "This is an error";
  });

  try {
    await Stream.FromPromise(promiseFixture)
      .map((data) => {
        return {
          ...data,
          mappedData: "mappedData",
        };
      })
      .toArray();
  } catch (err) {
    expect(err).toEqual("This is an error");
  }
});
