# Node.ts-Streams

[![npm version](https://img.shields.io/npm/v/node.ts-streams.svg)](https://www.npmjs.com/package/node.ts-streams)
[![CI](https://github.com/AGallouin/Node.ts-Streams/actions/workflows/ci.yml/badge.svg)](https://github.com/AGallouin/Node.ts-Streams/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/node.ts-streams.svg)](https://github.com/AGallouin/Node.ts-Streams/blob/master/LICENSE)

Typed, chainable wrapper around Node object-mode streams: backpressure everywhere,
concurrency-controlled `map`, type-guard `filter`, `Merge` / `split` / `flatMap`, and
`for await...of` consumption.

Zero dependencies. Ships CJS + ESM with full type declarations. Requires Node.js >= 18.

## Install

```sh
npm i node.ts-streams
```

## Quick start

```ts
import { Stream } from "node.ts-streams";

const enriched = await Stream.FromArray(userIds)
  .map((id) => db.users.find(id), { concurrency: 5 })
  .filter((user): user is User => user !== null)
  .split(100) // batches of 100
  .toArray();
```

## Why not native streams?

You can get far with `Readable.from()` and the built-in stream helpers. This library
exists for the parts that stay painful there:

- **Typing through the whole chain.** Every operator is generic: `map` infers its output
  type, a type-guard `filter` narrows `Stream<T | null>` to `Stream<T>`, and
  `MergeInOrder` produces a properly typed tuple stream. Native `readable.map` returns an
  untyped `Readable`.
- **Producer-side backpressure.** `await stream.pushAsync(e)` lets you feed a stream
  manually without ever buffering unboundedly; `FromIterable` pulls generators lazily.
- **Operators Node does not ship**: `split` (batching), `Merge`, `MergeInOrder`,
  order-preserving concurrent `map`.
- **Teardown by default.** Breaking out of a loop, an error, or a `destroy()` anywhere in
  the chain stops production all the way up — even for infinite sources.

If you only need `map`/`filter`/`toArray` over an existing `Readable` and types don't
matter, the native helpers are fine. If you are typing an object pipeline, this is the
comfortable version.

## Creating a Stream

```ts
// Type is inferred from the input
const stream = Stream.FromArray([1, 2, 3]);
const stream = Stream.FromIterable(myGenerator()); // any Iterable or AsyncIterable
const stream = Stream.FromPromise(db.findOne(id));
```

```ts
// Or push manually
const stream = new Stream<{ id: number }>();
stream.push({ id: 1 });
stream.end();
```

`FromIterable` consumes its input lazily: elements are only pulled when the stream has
room for them, so a slow consumer applies backpressure all the way up to the producer.
When pushing manually, `push` returns `false` when the internal buffer is full;
`await stream.pushAsync(e)` honors backpressure instead:

```ts
const stream = new Stream<Row>();
(async () => {
  for (const row of hugeDataSource) {
    await stream.pushAsync(row); // waits until the consumer has room
  }
  stream.end();
})();
```

`null` and `undefined` are valid elements: `Stream<number | null>` works as expected.
Pushing after `end()` throws: `end()` marks the stream complete, `destroy()` aborts it.

## Transforming

Transformations return a new `Stream`, so they chain. A stream can be **consumed only
once**: chaining a transformation claims the stream, and consuming it a second time
throws synchronously instead of silently producing nothing.

### map

Synchronous or asynchronous, with an optional concurrency. The output order always
matches the input order:

```ts
stream.map((input) => ({ input, date: Date.now() }));
stream.map((input) => db.find(input)); // async callbacks run sequentially by default
stream.map((input) => db.find(input), { concurrency: 5 }); // 5 at a time, order kept
```

### filter

Always synchronous. A type guard predicate narrows the resulting Stream:

```ts
stream.filter((e) => e.errors.length === 0);

// Stream<number | null> becomes Stream<number>
stream.filter((e): e is number => e !== null);
```

### flatMap

Maps each element to a Stream and flattens the result, exhausting each inner stream in
order:

```ts
// Stream<Directory> -> Stream<File>
directories.flatMap((dir) => Stream.FromIterable(walk(dir)));
```

### split

Groups elements into arrays of `chunkSize` (the last chunk may be smaller). Useful for
batched writes:

```ts
// Stream<Row> -> Stream<Array<Row>>
rows.split(500).forEach((batch) => db.insertMany(batch));
```

### reduce

Accumulates all elements into a single value, pushed as the only element of the
resulting Stream when the input ends:

```ts
const [total] = await stream.reduce((acc, curr) => acc + curr, 0).toArray();
```

### Merge

Merges several streams into one, in arrival order. The result is typed as the union of
the inputs and ends when every input has ended:

```ts
// Stream<A> and Stream<B> -> Stream<A | B>
const merged = Stream.Merge([streamA, streamB]);
```

### MergeInOrder

Merges several streams rank by rank into a tuple stream: it waits until every input has
produced its n-th element, then pushes them together. Exhausted inputs contribute
`undefined`:

```ts
// Stream<number> and Stream<string> -> Stream<[number | undefined, string | undefined]>
const zipped = Stream.MergeInOrder([numbers, strings]);
```

## Consuming

### for await...of

Streams are async iterables. Consuming this way honors backpressure: elements are only
produced as fast as the loop consumes them. Breaking out of the loop tears the whole
chain down:

```ts
for await (const value of stream.map((e) => e * 10)) {
  // use value here
}
```

### toArray

Exhausts the Stream into an array. Rejects if the Stream errors:

```ts
const values = await stream.toArray();
```

### forEach

Calls the (possibly async) callback for each element, sequentially. Resolves when the
Stream is exhausted, rejects if the callback throws:

```ts
await stream.forEach(async (value, i) => {
  await db.insert(value);
});
```

### addWritingStream

The low-level consumer: the callback receives each element and a `next` function that
MUST be called to receive the next one. Calling `next(error)` stops the Stream and
rejects the returned promise:

```ts
await stream.addWritingStream((chunk, encoding, next) => {
  socket.write(serialize(chunk), () => next());
});
```

## Errors and teardown

Errors are terminal: when a callback throws (or a source errors), the error is delivered
to the consumer (`toArray`/`forEach` reject, `for await` throws) and the whole pipeline
is torn down — upstream production stops instead of silently draining in the background.

An error fired before the consumer attaches (eg. `FromPromise` of an already rejected
promise) does not crash the process: it is kept and delivered whenever the Stream is
consumed.

Stopping consumption early does the same: breaking out of a `for await...of` loop, or
calling `stream.destroy()`, propagates the teardown up the chain, so even an infinite
source (eg. an infinite generator behind `FromIterable`) stops being pulled.

`destroy()` is an abort, everywhere: destroying a Stream that a consumer is waiting on
rejects that consumer with a `"Premature close"` error, and destroying a source of a
`Merge`/`MergeInOrder` fails the merged stream the same way. To complete a Stream early
but gracefully — delivering what was already produced — call `end()` instead.

## API summary

| Member | Signature |
| --- | --- |
| `Stream.FromArray` | `<T>(input: Array<T>) => Stream<T>` |
| `Stream.FromIterable` | `<T>(input: Iterable<T> \| AsyncIterable<T>) => Stream<T>` |
| `Stream.FromPromise` | `<T>(input: Promise<T>) => Stream<T>` |
| `Stream.Merge` | `(streams: Array<Stream<any>>) => Stream<union>` |
| `Stream.MergeInOrder` | `(streams: Array<Stream<any>>) => Stream<tuple>` |
| `push` / `pushAsync` | `(e: T) => boolean` / `(e: T) => Promise<void>` |
| `end` / `destroy` | `() => void` |
| `map` | `<O>(f: (v: T) => O \| Promise<O>, opts?: { concurrency?: number }) => Stream<Awaited<O>>` |
| `filter` | `(f: (v: T) => boolean) => Stream<T>` (type guards narrow) |
| `flatMap` | `<O>(f: (v: T) => Stream<O>) => Stream<O>` |
| `split` | `(chunkSize: number) => Stream<Array<T>>` |
| `reduce` | `<O>(f: (acc: O, curr: T) => O, initial: O) => Stream<O>` |
| `forEach` | `(f: (v: T, i: number) => void \| Promise<void>) => Promise<void>` |
| `addWritingStream` | `(f: (chunk: T, enc: BufferEncoding, next: (e?: Error \| null) => void) => void) => Promise<void>` |
| `toArray` | `() => Promise<Array<T>>` |
| `[Symbol.asyncIterator]` | `for await (const v of stream)` |

## License

[MIT](https://github.com/AGallouin/Node.ts-Streams/blob/master/LICENSE)
