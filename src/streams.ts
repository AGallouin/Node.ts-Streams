import { Readable, Transform, Writable } from 'stream'

export class Stream<T> {
  private readonly underlying: Readable
  
  constructor(stream: Readable) {
    this.underlying = stream
  }
  
  map<O>(map: (value: T) => O): Stream<O> {
    const stream = new Transform({
      objectMode: true,
      transform: (data, encoding, callback) => {
        callback(undefined, map(data))
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
  
  addWritingStream(write: (chunk: T, encoding: string, callback: (error?: Error | null) => void) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const stream = new Writable({ objectMode: true, write })
      
      this.underlying
        .pipe(stream)
        .on('finish', () => {
          resolve()
        })
        .on('error', () => {
          reject()
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
        if (acc.length === nbElements - 1) {
          rStream.push(acc)
          acc = []
        }
        next()
      }
    })
    
    this.underlying
      .pipe(wStream)
      .on('finish', () => {
        rStream.push(acc)
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
