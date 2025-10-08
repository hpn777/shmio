import { SharedMemory } from './SharedMemory'

const MESSAGE_HEADER_SIZE = 2

class SharedMemoryIterator implements Iterator<Buffer> {
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

  // debug mode: validate frame integrity (zero production overhead when disabled)
  private readonly debugMode: boolean = process.env.SHMIO_DEBUG === 'true'

  constructor(
    private sharedMemory: SharedMemory,
    fromIndex: number,
    toIndex: number,
  ) {
    const overlap = sharedMemory.getConfig().overlap
    this.buffers = sharedMemory.getBuffers()
    this.bufferLength = this.buffers[0].length - overlap

    this.totalSize = toIndex

    this.bufferIndex = Math.floor(fromIndex / this.bufferLength)

    this.buffersTotal = this.bufferLength * this.bufferIndex

    this.currentBuffer = this.buffers[this.bufferIndex]
    this.index = fromIndex % this.bufferLength

    // if size is size of our header then overwrite next method
    // so we can finish immediately
    if (this.totalSize <= fromIndex) {
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
    const size = this.currentBuffer.readUInt16LE(this.index)
    
    // Debug mode: validate frame integrity
    if (this.debugMode) {
      // Sanity check: frame size must be reasonable
      if (size < MESSAGE_HEADER_SIZE * 2 || size > this.bufferLength) {
        throw new Error(
          `[DEBUG] Invalid frame size ${size} at offset ${this.buffersTotal + this.index} ` +
          `(buffer ${this.bufferIndex}, must be between ${MESSAGE_HEADER_SIZE * 2} and ${this.bufferLength})`
        )
      }
      
      // Validate symmetric frame: trailing size must match leading size
      const trailingSize = this.currentBuffer.readUInt16LE(this.index + size - MESSAGE_HEADER_SIZE)
      if (size !== trailingSize) {
        throw new Error(
          `[DEBUG] Frame corruption in iterator: leading size ${size} != trailing size ${trailingSize} ` +
          `at offset ${this.buffersTotal + this.index} (buffer ${this.bufferIndex})`
        )
      }
    }
    
    const item = {
      value: this.currentBuffer.slice(
        (this.index + MESSAGE_HEADER_SIZE),
        this.index + size - MESSAGE_HEADER_SIZE
      ),
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
  fromIndex: number,
  toIndex: number,
) => {
  return new SharedMemoryIterator(sharedMemory, fromIndex, toIndex)
}

export { SharedMemoryIterator, shmIter }
