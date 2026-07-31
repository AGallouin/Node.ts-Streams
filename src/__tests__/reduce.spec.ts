import { Fixtures } from ".";

test("Reduce must compute data", async () => {
  expect.assertions(1);
  const stream = Fixtures.createDefaultObjectStream();

  await stream
    .reduce((acc, curr) => {
      return acc + curr.id;
    }, 0)
    .addWritingStream((value, _, next) => {
      expect(value).toEqual(4950); // 4950 = (99 * 100)/2
      next();
    });
});

test("Reduce should handle errors", async () => {
  expect.assertions(1);

  const stream = Fixtures.createDefaultObjectStream();

  try {
    await stream
      .reduce(() => {
        throw "This is an error";
      }, {})
      .toArray();
  } catch (err) {
    expect(err).toEqual("This is an error");
  }
});

test("Reduce should pipe errors", async () => {
  expect.assertions(1);
  const stream = Fixtures.createDefaultObjectStream();

  try {
    await stream
      .map(() => {
        throw "This is an error";
      })
      .reduce((acc) => {
        return acc;
      }, 0)
      .toArray();
  } catch (err) {
    expect(err).toEqual("This is an error");
  }
});
