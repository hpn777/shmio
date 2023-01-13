import test from 'tape'
import { range } from 'lodash'
import { promises as fs } from 'fs'
import { SharedMemory, shmIter, Pool } from '../../lib'
import { getBendec } from './types'

test('shm iterator', async t2 => {
  const bendec = getBendec()

  const encoder = new TextEncoder()
  const encode = encoder.encode.bind(encoder)

  const MSG_SIZE = bendec.getSize('Sample')
  const MSG_SIZE_WITH_HEADER = MSG_SIZE + 2 * Pool.MESSAGE_HEADER_SIZE
  const OVERLAP = MSG_SIZE_WITH_HEADER
  const config = {
    path: '/dev/shm/test',
    size: 64,
    num: 4,
    overlap: OVERLAP,
    writable: true,
  }

  await fs.unlink(config.path).catch(() => undefined)

  const sharedMemory = new SharedMemory(config)
  const buffers = sharedMemory.getBuffers()

  const pool = new Pool(bendec, sharedMemory)

  const slices = range(1, 11).map(i => {
    const slice = pool.slice('Sample')
    bendec.encodeAs({
      foo: encode(`lorem ipsum ${i}`)
    }, 'Sample', slice)
    return slice
  })

  pool.commit()

  test('all combinations', t => {
    slices.forEach((slice, from) => {
      range(1, slices.length - from).forEach(l => {

        const to = l + from
        const subSlice = slices.slice(from, to)

        const iter = shmIter(
          sharedMemory,
          Pool.HEADER_SIZE + from * MSG_SIZE_WITH_HEADER,
          pool.getSize()[0]
        )

        const result = [...iter]
        subSlice.forEach((buffer, i) => {
          let decodedBuffer = bendec.decodeAs(result[i],'Sample')
          decodedBuffer.foo = String.fromCharCode(...decodedBuffer.foo)
          t.deepEquals(result[i], buffer)
        })
      })
    })

    t.end()
  })

  t2.end()
})
