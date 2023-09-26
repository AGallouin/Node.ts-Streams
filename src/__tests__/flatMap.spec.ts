import { Fixtures } from ".";

test("Flat map should merge streams", async () => {
  expect.assertions(1);
  const stream = Fixtures.createDefaultNumberStream(0, 10);

  const res = await stream
    .flatMap((data) => {
      return Fixtures.createDefaultNumberStream(0, 10).map((c) => {
        return data * c;
      });
    })
    .toArray();

  const resArray = [];
  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 10; j++) {
      resArray.push(i * j);
    }
  }

  expect(res).toEqual(resArray);
});

test("Flat map should merge Async streams", async () => {
  expect.assertions(1);
  const stream = Fixtures.createDefaultNumberStream(1, 1);

  const res = await stream
    .flatMap(() => {
      return Fixtures.createAsyncStream(0, 10, 200);
    })
    .toArray();

  const resArray = [];
  for (let i = 0; i < 10; i++) {
    resArray.push({
      id: i,
      info: `information::${i}`,
    });
  }

  expect(res).toEqual(resArray);
});

test("Flat Map should handle error", async () => {
  expect.assertions(1);

  const stream = Fixtures.createDefaultObjectStream();

  try {
    await stream
      .flatMap(() => {
        return Fixtures.createAsyncStream(0, 10, 200).map(() => {
          throw "This is an error";
        });
      })
      .toArray();
  } catch (err) {
    expect(err).toEqual("This is an error");
  }
});

test("Flat map should pipe errors", async () => {
  expect.assertions(1);
  const stream = Fixtures.createDefaultObjectStream();

  try {
    await stream
      .map(() => {
        throw "This is an error";
      })
      .flatMap(() => {
        return Fixtures.createAsyncStream(0, 10, 200);
      })
      .toArray();
  } catch (err) {
    expect(err).toEqual("This is an error");
  }
});
