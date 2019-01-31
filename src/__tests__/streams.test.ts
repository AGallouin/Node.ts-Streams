import { Readable } from 'stream'

import { Stream } from '../streams'

interface DefaultStreamItem {
  id: number
  info: string
}

function createDefaultStream(): Readable {
  const readable = new Readable({
    objectMode: true,
    read: () => {}
  })
  
  for (let i = 0; i < 100; i++) {
    readable.push({ id: i, info: `information::${i}` })
  }
  
  readable.push(null)
  
  return readable
}

function createDefaultArray(): Array<DefaultStreamItem> {
  const inputArray: Array<DefaultStreamItem> = []
  
  for (let i = 0; i < 100; i++) {
    inputArray.push({ id: i, info: `information::${i}` })
  }
  
  return inputArray
}

test('Map must transform data sync', async () => {
  expect.assertions(101)
  const stream = new Stream<DefaultStreamItem>(createDefaultStream())
  
  const res = await stream
    .map((data) => {
      return {
        ...data,
        id: 'This is now a string'
      }
    })
    .addWritingStream((info, encoding, next) => {
      expect(info.id).toEqual('This is now a string')
      next()
    })
  
  expect(res).toEqual(true)
})

test('Map must transform data Async', async () => {
  expect.assertions(101)
  const stream = new Stream<DefaultStreamItem>(createDefaultStream())
  
  const res = await stream
    .map((data) => {
      return Promise.resolve({
        ...data,
        id: 'This is now a string'
      })
    })
    .addWritingStream((info, encoding, next) => {
      expect(info.id).toEqual('This is now a string')
      next()
    })
  
  expect(res).toEqual(true)
})

test('Reduce must compute data', async () => {
  expect.assertions(2)
  const stream = new Stream<DefaultStreamItem>(createDefaultStream())
  
  const res = await stream
    .reduce((acc, curr) => {
      return acc + curr.id
    }, 0)
    .addWritingStream((value, encoding, next) => {
      expect(value).toEqual(4950)
      next()
    })
  
  expect(res).toEqual(true)
})

test('Split must create chunks', async () => {
  expect.assertions(51)
  const stream = new Stream<DefaultStreamItem>(createDefaultStream())
  
  const res = await stream
    .split(2)
    .addWritingStream((chunk, encoding, next) => {
      expect(chunk.length).toEqual(2)
      next()
    })
  
  expect(res).toEqual(true)
})

test('Filter, fromArray and toArray must work', async () => {
  expect.assertions(50)
  const stream = Stream.fromArray(createDefaultArray())
  
  const resArray = await stream
    .filter((e) => e.id > 50)
    .toArray()
  
  expect(resArray.length).toEqual(49)
  
  for (let i = 0; i < resArray.length; i ++) {
    expect(resArray[i].info).toEqual(`information::${i + 51}`)
  }
})
