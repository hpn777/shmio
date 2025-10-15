import test from 'tape'
import { range } from 'lodash'
import { promises as fs } from 'fs'
import { createSharedLog } from '../../lib/SharedLog'
import { getBendec } from './types'

const bendec = getBendec()
const logPath = (name: string) => `/dev/shm/${name}`

const encodeSample = (buffer: Buffer, value: string) => {
  const payload = value.padEnd(13, ' ').slice(0, 13)
  bendec.encodeAs({
    foo: Buffer.from(payload, 'utf8'),
  }, 'Sample', buffer)
}

const createWritableLog = async (name: string, messageCount: number) => {
  const path = logPath(name)
  await fs.unlink(path).catch(() => undefined)

  const log = createSharedLog({
    path,
    capacityBytes: 128 * 1024,
    writable: true,
  })

  const writer = log.writer
  if (!writer) {
    throw new Error('Writable log should expose a writer')
  }

  const msgSize = bendec.getSize('Sample')
  range(0, messageCount).forEach(i => {
    const slice = writer.allocate(msgSize)
    encodeSample(slice, `payload-${i}`)
  })
  writer.commit()

  return log
}

test('native iterator nextBatch respects limits', async t => {
  const log = await createWritableLog('native-iterator-basic', 10)
  const iterator = log.createIterator()

  const msgSize = bendec.getSize('Sample')
  const frameBytes = msgSize + 4

  const batch = iterator.nextBatch({ maxMessages: 3, maxBytes: frameBytes * 5 })
  t.equal(batch.length, 3, 'should respect maxMessages')
  t.ok(Buffer.isBuffer(batch[0]), 'batch entries should be Buffers')

  if (batch[0]) {
    const originalByte = batch[0][0]
    batch[0][0] = (originalByte ^ 0xff) & 0xff
    const confirm = log.createIterator()
    const firstFrame = confirm.next()
    t.ok(firstFrame, 'iterator should return first frame')
    if (firstFrame) {
      t.equal(firstFrame[0], batch[0][0], 'modifying frame buffer mutates shared memory')
    }
    confirm.close()
    batch[0][0] = originalByte
  }

  const batch2 = iterator.nextBatch({ maxMessages: 10, maxBytes: frameBytes * 2 })
  t.equal(batch2.length, 2, 'should respect maxBytes')

  const cursorBefore = iterator.cursor()
  const remaining = iterator.nextBatch({ maxMessages: 100 })
  const cursorAfter = iterator.cursor()
  t.ok(cursorAfter > cursorBefore, 'cursor should advance after consuming frames')
  t.equal(remaining.length, 10 - 5, 'should return remaining frames')

  const committed = iterator.committedSize()
  const header = log.header
  t.equal(committed, header.size - header.dataOffset, 'committed size matches header report')

  const singleIterator = log.createIterator()
  const single = singleIterator.next()
  t.ok(Buffer.isBuffer(single), 'next() should return a Buffer when frames are available')
  singleIterator.close()

  iterator.close()
  log.close()
  t.end()
})

test('native iterator debug checks keep cursor stable on corruption', async t => {
  const log = await createWritableLog('native-iterator-corrupt', 1)
  const msgSize = bendec.getSize('Sample')
  const frameSize = msgSize + 4

  const header = log.header
  const headerSize = Number(header.headerSize)
  const suffixOffset = headerSize + msgSize + 2

  const fd = await fs.open(logPath('native-iterator-corrupt'), 'r+')
  try {
    const corruptValue = frameSize + 2
    const corruptionBuffer = new Uint8Array(2)
    corruptionBuffer[0] = corruptValue & 0xff
    corruptionBuffer[1] = (corruptValue >> 8) & 0xff
    await fd.write(corruptionBuffer, 0, corruptionBuffer.length, suffixOffset)
  } finally {
    await fd.close()
  }

  const iterator = log.createIterator()
  const cursorBefore = iterator.cursor()
  try {
    iterator.nextBatch({ debugChecks: true })
    t.fail('Expected iterator to throw on corrupt frame')
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    t.equal(err.code, 'ERR_SHM_FRAME_CORRUPT', 'should throw frame corrupt error code')
  }

  const cursorAfter = iterator.cursor()
  t.equal(cursorAfter, cursorBefore, 'cursor must remain unchanged after error')
  iterator.close()
  log.close()
  t.end()
})
