import fs from 'fs'
import test from 'tape'
import { SharedMemory } from '../../lib/SharedMemory'

test('Shared memory file is written in /dev/shm', t => {
  const path = '/dev/shm/test'
  const size = 8
  const num = 4

  if (fs.existsSync(path)) {
    fs.unlinkSync(path)
  }

  const shm = new SharedMemory({
    path,
    size,
    num,
    overlap: 0,
    writable: true,
  })

  const buffers = shm.getBuffers()

  const b0 = buffers[0]
  const b1 = buffers[1]
  const b3 = buffers[3]

  b0[0] = 65
  b0[1] = 66
  b0[2] = 67

  b1[3] = 68
  b1[4] = 69

  b3[5] = 70
  b3[size - 1] = 71

  const fileContents = fs.readFileSync(path)
  const allBuffers = Buffer.concat(buffers)

  t.deepEqual(allBuffers, fileContents)
  t.equal(fileContents.length, size * num)
  t.equal(buffers.length, num)
  // delete the file after test
  fs.unlinkSync(path)
  t.end()
})

test('Memory mapped file is written in /tmp', t => {
  const path = `/tmp/mapped_file_test`
  const size = 8
  const num = 4

  // delete the file before test
  if (fs.existsSync(path)) {
    fs.unlinkSync(path)
  }

  const shm = new SharedMemory({
    path,
    size,
    num,
    overlap: 0,
    writable: true,
  })

  const buffers = shm.getBuffers()

  buffers[0][0] = 65
  buffers[1][0] = 66
  buffers[2][0] = 67
  buffers[3][0] = 68
  buffers[3][size - 1] = 69

  const fileContents = fs.readFileSync(path)
  const allBuffers = Buffer.concat(buffers)

  t.deepEqual(allBuffers, fileContents)
  t.equal(fileContents.length, size * num)
  t.equal(buffers.length, num)
  // delete the file after test
  fs.unlinkSync(path)
  t.end()
})

test('non existent shm is opened for reading only', t => {
  const path = `/dev/shm/test_readonly`
  const size = 8
  const num = 4

  if (fs.existsSync(path)) {
    fs.unlinkSync(path)
  }

  t.throws(() => {
    /* tslint:disable:no-unused-expression */
    new SharedMemory({
      path,
      size,
      num,
      overlap: 0,
      writable: false,
    })
  })

  t.end()
})
