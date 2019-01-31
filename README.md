# Node.ts-Streams

Simple and lightweight wrapper for Node streams in Typescript.

Correctness and proper typescript typings.

### How to start

Instanciate the first instance of Stream with an Array or a Readable Stream (ie: from database)

```ts
    // Stream type but be specified if with a Readable stream
    const stream = new Stream<{ id: number }>(readableStream)
```

```ts
    // Stream type is inferred with an Array
    const stream = Stream.fromArray(array)
```

### Chain transformations and operations

Most transformations return an instance of Stream to allow chainning


#### Map to transform data

Synchronous:

```ts
    stream
        .map((input) => {
            return {
                informations: input,
                date: Date.now()
            }
        })
```

Asynchronous with a promise:

```ts
    stream
        .map((input) => {
            return db.find(input).then((data) => ({ input, data })
        })
```


#### Filter to clean data

Always synchronous

```ts
    stream
        .map((input) => {
            return db.find(input).then((data) => ({ input, data })
        })
        .filter((e) => e.data.errors.length === 0)
```


#### Reduce to compute data

```ts
    stream
        .reduce((acc, curr) => {
            return acc + curr
        }, 0)
```


#### Add a writing function to end the stream 

```ts
    stream
        addWritingStream((chunk, encoding, next) => {
            // use the chunk of data here and call next after that
        })
```


#### Use to Array to return in a standard Promise / array context

```ts
    stream
        .toArray()
        .then((streamAsArray) => {
            // use array here
        })
```