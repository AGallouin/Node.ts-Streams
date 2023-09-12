import { Readable } from "stream";

export interface DefaultStreamItem {
  id: number;
  info: string;
}

export function createDefaultObjectStream(initialValue = 0, length = 100): Readable {
  const readable = new Readable({
    objectMode: true,
    read: () => {},
  });

  for (let i = 0; i < length; i++) {
    readable.push({ id: i + initialValue, info: `information::${i + initialValue}` });
  }

  readable.push(null);

  return readable;
}

export function createDefaultNumberStream(initialValue = 0, length = 100): Readable {
  const readable = new Readable({
    objectMode: true,
    read: () => {},
  });

  for (let i = 0; i < length; i++) {
    readable.push(i + initialValue);
  }

  readable.push(null);

  return readable;
}

export function createDefaultStringStream(initialValue = 0, length = 100): Readable {
  const readable = new Readable({
    objectMode: true,
    read: () => {},
  });

  for (let i = 0; i < length; i++) {
    readable.push(`information::${i + initialValue}`);
  }

  readable.push(null);

  return readable;
}

export function createAsyncStream(initialValue = 0, length = 100, delay = 0): Readable {
  const readable = new Readable({
    objectMode: true,
    read: () => {},
  });

  let numberOfElements = 0;
  let intervalHolder: NodeJS.Timeout | undefined = undefined;

  intervalHolder = setInterval(() => {
    readable.push({
      id: numberOfElements + initialValue,
      info: `information::${numberOfElements + initialValue}`,
    });
    numberOfElements++;
    if (numberOfElements >= length && intervalHolder) {
      clearInterval(intervalHolder);
      readable.push(null);
    }
  }, delay);

  return readable;
}

export function createDefaultArray(): Array<DefaultStreamItem> {
  const inputArray: Array<DefaultStreamItem> = [];

  for (let i = 0; i < 100; i++) {
    inputArray.push({ id: i, info: `information::${i}` });
  }

  return inputArray;
}

export const lookup = "lookup";

export const dataFixture = {
  testString: "This is a string",
  testNumber: 0,
  testBoolean: true,
  testFunction: () => {
    return lookup;
  },
};
