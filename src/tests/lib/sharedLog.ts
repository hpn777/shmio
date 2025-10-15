import test from 'tape'
import { promises as fs } from 'fs'
import { range } from 'lodash'
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
  const payloads = range(0, 3).map(i => `payload-${i}`)

  payloads.forEach(value => {
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
