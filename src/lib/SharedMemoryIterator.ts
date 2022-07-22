import { Pool } from './Pool'
import { SharedMemory, SharedMemoryConfig } from './SharedMemory'

type ShmItem = [number, Buffer, number]

/**
 * Iterator over a messages in the (commited) shared memory
 * TODO: Perhaps use generator for this?
 * TODO: generator perf tests
 *
 * see lib/Pool.ts for details of the memory layout
 *
 */
class SharedMemoryIterator implements Iterator<ShmItem> {
  // all buffers
  private buffers: Buffer[]
  // current buffer's index
  private index: number
  // which buffer we're iterating
  private bufferIndex: number = 0
  // reference to the current buffer
  private currentBuffer: Buffer
  // let's keep track on the total of buffer lengths
  // This we increment when we jump the next buffer
  // and it's calculated as follows:
  // buffersTotal = bufferLength * bufferIndex
  private buffersTotal: number = 0

  // the length of individual buffer
  private bufferLength: number

  // totalSize of the memory
  // this is calculated at the time of instantination
  private totalSize: number

  constructor(
    private sharedMemory: SharedMemory,
    fromIndex: number = Pool.HEADER_SIZE,
    toIndex?: number,
  ) {
    const overlap = sharedMemory.getConfig().overlap
    this.buffers = sharedMemory.getBuffers()
    this.bufferLength = this.buffers[0].length - overlap
   
    this.bufferIndex = Math.floor(fromIndex / this.bufferLength)

    this.buffersTotal = this.bufferLength * this.bufferIndex

    this.currentBuffer = this.buffers[this.bufferIndex]
    this.index = fromIndex % this.bufferLength

    if (toIndex !== undefined) {
      this.totalSize = toIndex
    } else {
      this.totalSize =
        this.buffers[0].readUInt32LE(0) +
        this.buffers[0].readUInt32LE(4) * 0x100000000
    }

    // if size is size of our header then overwrite next method
    // so we can finish immediately
    if (this.totalSize <= Pool.HEADER_SIZE) {
      // Strange because:
      // https://github.com/Microsoft/TypeScript/issues/11375
      // https://github.com/Microsoft/TypeScript/issues/28670
      this.next = () => {
        return { value: undefined as any, done: true }
      }
    }
  }

  public [Symbol.iterator]() {
    return this
  }

  public next() {
    if (this.buffersTotal + this.index >= this.totalSize) {
      return {
        value: undefined as any,
        done: true,
      }
    }

    const size = this.currentBuffer.readUInt32LE(this.index)

    const item = {
      value: [
        this.buffersTotal + this.index,
        this.currentBuffer.slice(
          (this.index += Pool.MESSAGE_HEADER_SIZE),
          this.index + size
        ),
        size,
        size,
      ],
      done: false,
    }

    this.index += size

    if (this.index >= this.bufferLength) {
      this.index -= this.bufferLength
      this.bufferIndex++
      this.buffersTotal += this.bufferLength
      this.currentBuffer = this.buffers[this.bufferIndex]
    }

    return item
  }
}

const shmIter = (
  sharedMemory: SharedMemory,
  fromIndex: number = Pool.HEADER_SIZE,
  toIndex?: number,
) => {
  return new SharedMemoryIterator(sharedMemory, fromIndex, toIndex)
}

export { SharedMemoryIterator, ShmItem, shmIter }
