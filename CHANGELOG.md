# Changelog

## 2.0.0 (2026-07-31)

### Breaking changes

- A Stream is now explicitly **single-consumer**: consuming a Stream a second time (a
  second `toArray`, a second chained transformation, ...) throws
  `"Stream already consumed"` synchronously — in every consumer, including `flatMap`,
  `Merge` and `MergeInOrder` — instead of silently producing no data.
- `destroy()` is consistently an abort: destroying a Stream mid-consumption rejects its
  consumer with a `"Premature close"` error (it used to leave the promise pending
  forever), and destroying a source of a `Merge`/`MergeInOrder` fails the merged
  stream. Use `end()` to complete a Stream early but gracefully.
- `push`/`pushAsync` after `end()` throw a clear synchronous error instead of
  triggering an async, misattributed stream error.
- `forEach` and `addWritingStream` now return `Promise<void>` instead of a
  `Promise<boolean>` that always resolved to `true`.
- `stream.emit("error", e)` is now terminal, as its documentation always stated: it
  destroys the Stream after delivering the error.
- `map` is typed `Stream<Awaited<O>>`: promise results were always awaited at runtime,
  now an explicit `map<Promise<X>>(...)` type argument cannot produce a lying
  `Stream<Promise<X>>` anymore.
- `addWritingStream`'s callback types its `encoding` parameter as `BufferEncoding`
  instead of `string` (callbacks written against `string` remain compatible).

### Fixed

- An error fired before any consumer attached (eg. `Stream.FromPromise` of an already
  rejected promise) crashed the whole process with an uncaught `'error'` event. The
  error is now kept and delivered when the Stream is consumed, however late that is.
- `Stream.Merge([])` and `Stream.MergeInOrder([])` never ended; they now end
  immediately.
- Destroying a source stream directly while it was part of a `Merge`/`MergeInOrder`
  left the merged stream hanging forever; the destroyed source is now counted as closed
  after its pending writes flush.
- Consuming a Stream that was destroyed before consumption hung forever; it now rejects
  with a `"Premature close"` error.
- `split(0)` (or a negative/fractional/NaN size) silently buffered the entire stream
  into a single array; the chunk size is now clamped to an integer >= 1.
- An `addWritingStream` callback that called `next()` and then threw crashed with
  Node's `"Callback called multiple times"`; the late error is now delivered as a
  regular stream error. An async callback whose promise rejects no longer causes an
  unhandled rejection either.
- `map` with `concurrency > 1` crashed the whole process with an unhandled rejection
  when a callback failed while an earlier, slower callback was still running; the
  rejection is now observed immediately and delivered to the consumer in order.
- A falsy error value (`throw 0`, `Promise.reject(undefined)`, ...) landing before
  consumption was misreported as a `"Premature close"`; it is now wrapped and the
  original value preserved in the message.
- `flatMap` on an already consumed Stream silently destroyed the stream under the feet
  of its legitimate consumer; it now throws upfront like every other transformation.
- `Merge`/`MergeInOrder` with one already consumed source threw halfway through
  construction, leaving the other sources claimed and piped into an abandoned merge;
  all sources are now checked before any of them is claimed or wired.
- `FromIterable` pulled one extra element from its source after a teardown — one
  unwanted fetch for sources with side effects per pull (DB cursors, paginated APIs).
- `MergeInOrder` rows for exhausted sources contained array holes or were short; rows
  are now dense, with a real `undefined` per exhausted column, matching the tuple type.

### Added

- `CHANGELOG.md`, CI workflow, `engines`, `sideEffects` and `keywords` package
  metadata.
- A full API reference in the README, including the previously undocumented `Merge`,
  `MergeInOrder`, `split`, `flatMap` and `forEach`.

## 1.1.0 (2026-07-31)

- Fixed a bug where `split` could lose data.
- `pushAsync` honors backpressure; `FromIterable` consumes its input lazily.
- Teardown propagation: breaking out of `for await...of`, calling `destroy()` or an
  error tears down the whole chain, stopping upstream production.
- Streams are consumable with `for await...of`.
- `null` and `undefined` are valid stream elements.
- `map` accepts a `concurrency` option, preserving output order.
- Dual CJS/ESM build with type declarations.

## 1.0.0 - 1.0.4 (2019)

- Initial releases: `map`, `filter`, `reduce`, `split`, `flatMap`, `forEach`,
  `Merge`, `MergeInOrder`, `addWritingStream`, `toArray`, `FromArray`, `FromPromise`.
