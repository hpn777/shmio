/**
 * To test if accessing readonly memmap file segfaults
 */
import { SharedMemory } from '../../lib/SharedMemory'

const path = `/dev/shm/test_readonly`
const size = 8
const num = 4

const shmRead = new SharedMemory({
  path,
  size,
  num,
  overlap: 0,
  writable: false,
})

const buffersRead = shmRead.getBuffers()
buffersRead[0][0] = 65
