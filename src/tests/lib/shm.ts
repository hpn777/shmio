import test from 'tape'
import { range } from 'lodash'
import { promises as fs } from 'fs'
import { SharedMemory, shmIter, Pool } from '../../lib'
import { getBendec } from './types'

test('shm iterator', async t2 => {
  const bendec = getBendec()
  
  const MSG_SIZE = bendec.getSize('Sample')
  const MSG_SIZE_WITH_HEADER = MSG_SIZE + Pool.MESSAGE_HEADER_SIZE
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

  const pool = Pool.withBuffers(bendec, buffers, config.overlap)

  const slices = range(1, 11).map(i => {
    const slice = pool.slice('Sample')
    
    bendec.encode({
      foo: 'dupa jasiu'.split('').map(char => char.charCodeAt(0))
    }, slice)
    console.log(slice)
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
          Pool.HEADER_SIZE + to * MSG_SIZE_WITH_HEADER
        )

        const result = [...iter]

        subSlice.forEach((buffer, i) => {
          // console.log('read',bendec.decode(buffer))
          t.deepEquals(result[i][1], buffer)
        })
      })
    })

    t.end()
  })

  t2.end()
})
