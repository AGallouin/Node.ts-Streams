import { Stream } from "../index";

export interface DefaultStreamItem {
  id: number;
  info: string;
}

export function createDefaultObjectStream(
  initialValue = 0,
  length = 100
): Stream<DefaultStreamItem> {
  const readable = new Stream<DefaultStreamItem>();

  for (let i = 0; i < length; i++) {
    readable.push({ id: i + initialValue, info: `information::${i + initialValue}` });
  }

  readable.end();

  return readable;
}

export function createDefaultNumberStream(initialValue = 0, length = 100): Stream<number> {
  const readable = new Stream<number>();

  for (let i = 0; i < length; i++) {
    readable.push(i + initialValue);
  }

  readable.end();

  return readable;
}

export function createDefaultStringStream(initialValue = 0, length = 100): Stream<string> {
  const readable = new Stream<string>();

  for (let i = 0; i < length; i++) {
    readable.push(`information::${i + initialValue}`);
  }

  readable.end();

  return readable;
}

export function createAsyncStream(
  initialValue = 0,
  length = 100,
  delay = 0
): Stream<DefaultStreamItem> {
  const readable = new Stream<DefaultStreamItem>();

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
      readable.end();
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
