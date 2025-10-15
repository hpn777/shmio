import test from 'tape'
import { promises as fs } from 'fs'
import { createSharedLog } from '../../lib/SharedLog'

/**
 * Validate that opening a shared log in read-only mode does not segfault and exposes iterator access only.
 */
test('read-only shared log exposes iterator without writer', async t => {
  const path = `/dev/shm/test_readonly`
  await fs.unlink(path).catch(() => undefined)

  const writable = createSharedLog({
    path,
    capacityBytes: 64,
    writable: true,
  })

  const writer = writable.writer
  if (!writer) {
    t.fail('Writable shared log must expose a writer')
    writable.close()
    t.end()
    return
  }

  const payload = Buffer.from('immutable', 'utf8')
  const slice = writer.allocate(payload.length)
  slice.set(payload)
  writer.commit()
  writable.close()

  const readonly = createSharedLog({
    path,
    capacityBytes: 64,
    writable: false,
  })

  t.notOk(readonly.writer, 'read-only log should not expose a writer')

  const iterator = readonly.createIterator()
  const frame = iterator.next()
  t.ok(frame, 'iterator should yield frame from read-only log')
  if (frame) {
    t.equal(frame.toString('utf8').replace(/\u0000+$/, ''), 'immutable', 'frame payload should match written value')
  }

  iterator.close()
  readonly.close()
  await fs.unlink(path).catch(() => undefined)
  t.end()
})
