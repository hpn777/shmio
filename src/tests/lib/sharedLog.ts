import test from 'tape'
import { promises as fs } from 'fs'
import { createSharedLog } from '../../lib/SharedLog'

const logPath = (name: string) => `/dev/shm/${name}`

const writeString = (buffer: Buffer, value: string) => {
  buffer.fill(0)
  buffer.write(value, 'utf8')
}

test('shared log writer allocates frames and iterator reads them', async t => {
  const path = logPath('shared-log-basic')
  await fs.unlink(path).catch(() => undefined)

  const log = createSharedLog({
    path,
    capacityBytes: 64 * 1024,
    writable: true,
  })

  t.ok(log.writer, 'writer should be available for writable log')
  const writer = log.writer!
  const payloads = Array.from({ length: 3 }, (_, i) => `payload-${i}`)

  payloads.forEach((value: string) => {
    const buf = writer.allocate(32)
    writeString(buf, value)
  })

  writer.commit()

  const iterator = log.createIterator()
  const frames = iterator.nextBatch({ maxMessages: 10 })
  t.equal(frames.length, payloads.length, 'iterator should return committed frames')
  frames.forEach((frame, index) => {
    const decoded = frame.toString('utf8').replace(/\u0000+$/, '')
    t.equal(decoded, payloads[index], 'frame contents should match the written payload')
  })

  const header = log.header
  t.ok(header.size > header.dataOffset, 'header.size should advance after commit')

  iterator.close()
  log.close()
  t.end()
})

test('reader ignores provided capacity when mapping existing log', async t => {
  const path = logPath('shared-log-capacity-mismatch')
  await fs.unlink(path).catch(() => undefined)

  const writerLog = createSharedLog({
    path,
    capacityBytes: 64 * 1024,
    writable: true,
  })

  const writer = writerLog.writer!
  const payload = 'mismatch-payload'
  const frame = writer.allocate(64)
  writeString(frame, payload)
  writer.commit()

  writerLog.close()

  const readerLog = createSharedLog({
    path,
    capacityBytes: 8 * 1024,
    writable: false,
  })

  const iterator = readerLog.createIterator()
  const frames = iterator.nextBatch({ maxMessages: 4 })
  t.equal(frames.length, 1, 'reader should see committed frame with mismatched capacityBytes')
  const decoded = frames[0].toString('utf8').replace(/\u0000+$/, '')
  t.equal(decoded, payload, 'frame contents should match despite mismatched capacityBytes')

  iterator.close()
  readerLog.close()

  const stat = await fs.stat(path)
  t.equal(stat.size, 64 * 1024, 'actual file size should remain unchanged')

  await fs.unlink(path).catch(() => undefined)
  t.end()
})
