# Node.ts-Streams

Simple and lightweight wrapper for Node streams in Typescript.

Correctness and proper typescript typings.

### Install

```sh
npm i node.ts-streams
```

### How to start

Create a Stream from an Array, any (async) iterable, or a Promise — or push into it manually:

```ts
// Type is inferred from the input
const stream = Stream.FromArray([1, 2, 3]);
const stream = Stream.FromIterable(myGenerator());
const stream = Stream.FromPromise(db.findOne(id));
```

```ts
// Or push manually
const stream = new Stream<{ id: number }>();
stream.push({ id: 1 });
stream.end();
```

`FromIterable` consumes its input lazily: elements are only pulled when the stream has room
for them, so a slow consumer applies backpressure all the way up to the producer. When
pushing manually, `push` returns `false` when the internal buffer is full; `await stream.pushAsync(e)`
honors backpressure instead.

### Chain transformations and operations

Most transformations return an instance of Stream to allow chaining.

#### Map to transform data

Synchronous:

```ts
stream.map((input) => {
  return {
    informations: input,
    date: Date.now(),
  };
});
```

Asynchronous with a promise:

```ts
stream.map((input) => {
  return db.find(input).then((data) => ({ input, data }));
});
```

Async callbacks run sequentially by default, keeping the output order. Pass a
`concurrency` option to run several at the same time — the output order is still
preserved:

```ts
stream.map((input) => db.find(input), { concurrency: 5 });
```

#### Filter to clean data

Always synchronous:

```ts
stream
  .map((input) => db.find(input).then((data) => ({ input, data })))
  .filter((e) => e.data.errors.length === 0);
```

A type guard predicate narrows the resulting Stream:

```ts
// Stream<number | null> becomes Stream<number>
stream.filter((e): e is number => e !== null);
```

#### Reduce to compute data

```ts
stream.reduce((acc, curr) => {
  return acc + curr;
}, 0);
```

#### Consume with for await...of

Streams are async iterables. Consuming this way honors backpressure: elements are only
produced as fast as the loop consumes them.

```ts
for await (const value of stream.map((e) => e * 10)) {
  // use value here
}
```

#### Add a writing function to end the stream

```ts
stream.addWritingStream((chunk, encoding, next) => {
  // use the chunk of data here and call next after that
});
```

#### Use toArray to return in a standard Promise / array context

```ts
stream.toArray().then((streamAsArray) => {
  // use array here
});
```

### Errors and teardown

Errors are terminal: when a callback throws (or a source errors), the error is delivered to
the consumer (`toArray`/`forEach` reject, `for await` throws) and the whole pipeline is torn
down — upstream production stops instead of silently draining in the background.

Stopping consumption early does the same: breaking out of a `for await...of` loop, or
calling `stream.destroy()`, propagates the teardown up the chain, so even an infinite
source (eg. an infinite generator behind `FromIterable`) stops being pulled.
