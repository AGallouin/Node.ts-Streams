import { Readable, Transform, Writable } from 'stream'

export class Stream<T> {
  private readonly underlying: Readable
  
  constructor(stream: Readable) {
    this.underlying = stream
  }
  
  static fromArray<T>(input: Array<T>): Stream<T> {
    const readable = new Readable({
      objectMode: true,
      read: () => {}
    })
  
    for (let i = 0; i < input.length; i++) {
      readable.push(input[i])
    }
    readable.push(null)
  
    return new Stream<T>(readable)
  }
  
  map<O>(map: (value: T) => O | Promise<O>): Stream<O> {
    const stream = new Transform({
      objectMode: true,
      transform: (data, encoding, callback) => {
        Promise.resolve(map(data))
          .then((v) => callback(undefined, v))
      }
    })
    
    this.underlying.pipe(stream)
    
    return new Stream<O>(stream)
  }
  
  reduce<O>(reducer: (acc: O, curr: T) => O, initialValue: O): Stream<O> {
    let acc = initialValue
    const wStream = new Writable({
      objectMode: true,
      write: (curr, encoding, next) => {
        acc = reducer(acc, curr)
        next()
      }
    })
    const rStream = new Readable({
      objectMode: true,
      read: () => {}
    })
    
    this.underlying
      .pipe(wStream)
      .on('finish', () => {
        rStream.push(acc)
        rStream.push(null)
      })
    
    return new Stream<O>(rStream)
  }
  
  filter(filter: (value: T) => boolean): Stream<T> {
    const stream = new Transform({
      objectMode: true,
      transform: (data, encoding, callback) => {
        if (filter(data)) {
          callback(undefined, data)
        } else {
          callback()
        }
      }
    })
    
    this.underlying.pipe(stream)
    
    return new Stream<T>(stream)
  }
  
  addWritingStream(write: (chunk: T, encoding: string, callback: (error?: Error | null) => void) => void): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const stream = new Writable({ objectMode: true, write })
      
      this.underlying
        .pipe(stream)
        .on('finish', () => {
          resolve(true)
        })
        .on('error', () => {
          reject(false)
        })
    })
  }
  
  split(nbElements: number): Stream<Array<T>> {
    let acc: Array<T> = []
    const rStream = new Readable({
      objectMode: true,
      read: () => {}
    })
    const wStream = new Writable({
      objectMode: true,
      write: (curr, encoding, next) => {
        acc.push(curr)
        if (acc.length === nbElements) {
          rStream.push(acc)
          acc = []
        }
        next()
      }
    })
    
    this.underlying
      .pipe(wStream)
      .on('finish', () => {
        if (acc.length > 0) {
          rStream.push(acc)
        }
        rStream.push(null)
      })
    
    return new Stream<Array<T>>(rStream)
  }
  
  toArray(): Promise<Array<T>> {
    return new Promise((resolve) => {
      const acc: Array<T> = []
      const wStream = new Writable({
        objectMode: true,
        write: (curr, encoding, next) => {
          acc.push(curr)
          next()
        }
      })
      
      this.underlying
        .pipe(wStream)
        .on('finish', () => {
          resolve(acc)
        })
    })
  }
}
