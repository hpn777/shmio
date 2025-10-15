import fs from 'fs'
import test from 'tape'
import { createSharedLog } from '../../lib/SharedLog'

const writeFrame = (logPath: string) => {
  const log = createSharedLog({
    path: logPath,
    capacityBytes: 64,
    writable: true,
  })

  if (!log.writer) {
    throw new Error('Expected writable shared log to expose a writer')
  }

  const payload = Buffer.from('hello', 'utf8')
  const slice = log.writer.allocate(payload.length)
  slice.set(payload)
  log.writer.commit()
  log.close()

  const contents = fs.readFileSync(logPath)
  const headerSize = Number(contents.readBigUInt64LE(0))
  const dataOffset = Number(contents.readBigUInt64LE(8))
  const committedSize = Number(contents.readBigUInt64LE(16))
  const frameSize = contents.readUInt16LE(dataOffset)
  const payloadBytes = contents.subarray(dataOffset + 2, dataOffset + 2 + payload.length)
  const suffix = contents.readUInt16LE(dataOffset + frameSize - 2)

  return {
    contents,
    headerSize,
    dataOffset,
    committedSize,
    frameSize,
    payloadBytes,
    suffix,
  }
}

test('Shared log file is written in /dev/shm', t => {
  const path = '/dev/shm/test-shared-log'
  if (fs.existsSync(path)) {
    fs.unlinkSync(path)
  }

  const result = writeFrame(path)

  t.equal(result.headerSize, 24, 'header size should default to 24 bytes')
  t.equal(result.dataOffset, 24, 'data offset should follow header')
  t.equal(result.frameSize, result.payloadBytes.length + 4, 'frame size should include metadata bytes')
  t.equal(result.suffix, result.frameSize, 'trailing size should match frame size')
  t.equal(result.payloadBytes.toString('utf8'), 'hello', 'payload should be persisted to disk')
  t.equal(result.contents.length, 64, 'file should be truncated to requested capacity')

  fs.unlinkSync(path)
  t.end()
})

test('Memory mapped file is written in /tmp', t => {
  const path = '/tmp/mapped-shared-log'
  if (fs.existsSync(path)) {
    fs.unlinkSync(path)
  }

  const result = writeFrame(path)

  t.equal(result.headerSize, 24, 'header size should default to 24 bytes')
  t.equal(result.dataOffset, 24, 'data offset should follow header')
  t.equal(result.payloadBytes.toString('utf8'), 'hello', 'payload should be persisted to disk')
  t.equal(result.contents.length, 64, 'file should be truncated to requested capacity')

  fs.unlinkSync(path)
  t.end()
})

test('non existent shared log cannot be opened read-only', t => {
  const path = '/dev/shm/test-shared-log-readonly'
  if (fs.existsSync(path)) {
    fs.unlinkSync(path)
  }

  t.throws(() => {
    createSharedLog({
      path,
      capacityBytes: 64,
      writable: false,
    })
  }, 'opening read-only shared log without backing file should throw')

  t.end()
})
