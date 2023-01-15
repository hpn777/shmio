import assert from 'assert'
import { Bendec, BufferWrapper } from 'bendec'
import { SharedMemory } from './SharedMemory'
import { getBendec, MemHeader } from './memHeader'

// generic default
// TODO: never default generic to any!
// we need union from Bendec to be generated
type PoolType = any

/**
 * each message is prepended by the header
 * [u32][message]
 * first 4 bytes - size of message
 */
const MESSAGE_HEADER_SIZE: number = 2

const mhBendec = getBendec()


/**
 * The size of the shared memory header
 * u64 - 8 bytes
 * this is actual [u32-low, u32-high] as nodejs can't handle u64s
 * so the number 0x0102030405060708 will be represented in bytes as:
 * [x01, x02, x03, x04, x05, x06, x07, x08]
 *
 */
const HEADER_SIZE: number = mhBendec.getSize('MemHeader')

/**
 * Buffer Pool
 *
 * Unfortunatelly nodejs has a limit on the size of Buffer
 * of about 1GB (or a half of it) and we have to manage
 * that transparently.
 *
 * TODO: Get rid of the uncommittedSize property
 * we can calculate it from current (index + buffersTotal)- currentSize
 */
class Pool<T = PoolType> {
  public static readonly MESSAGE_HEADER_SIZE = MESSAGE_HEADER_SIZE
  public static readonly HEADER_SIZE = HEADER_SIZE

  public bendec: Bendec<T>
  
  private memHeaderWrapper: MemHeader
  // at start we're skipping the header size
  private index: number = HEADER_SIZE
  private bufferIndex: number = 0
  // reference to the current Buffer
  private currentBuffer: Buffer
  private buffers: Buffer[]
  private bufferLength: number
  // this is an overlap between pages
  private overlap: number
  private uncommittedSize: number = 0
  // current size of the shared memory
  private currentSize: number = HEADER_SIZE
  private active: boolean = true

  public constructor(
    bendec: Bendec<T>,
    sharedMemory: SharedMemory,
    // if true we will rebuild this Pool from existing sharedMemory
  ) {
    this.bendec = bendec
    this.buffers = sharedMemory.getBuffers()

    this.memHeaderWrapper = mhBendec.getWrapper('MemHeader') as MemHeader
    this.memHeaderWrapper.setBuffer(this.buffers[0])

    this.overlap = sharedMemory.getConfig().overlap
    this.bufferLength = this.buffers[0].length - this.overlap
    this.currentBuffer = this.buffers[0]

    this.currentSize = Number(this.memHeaderWrapper.size)
    if (this.currentSize === 0) {
      this.memHeaderWrapper.headerSize = BigInt(HEADER_SIZE)
      this.memHeaderWrapper.size = BigInt(HEADER_SIZE)
      this.memHeaderWrapper.dataOffset = BigInt(HEADER_SIZE)
      this.currentSize = HEADER_SIZE
    }

    this.index = this.currentSize % this.bufferLength
    this.bufferIndex = Math.floor(this.currentSize / this.bufferLength)
    this.currentBuffer = this.buffers[this.bufferIndex]

    assert(this.buffers[0].length >= 32, 'Buffers must be at least 32 bytes')

    // Make sure all buffers have the same size
    assert(
      this.buffers.reduce(
        (r, buffer) => r && buffer.length === this.buffers[0].length,
        true
      ),
      'Buffers must be the same size'
    )
  }

  /**
   * Commiting shared memory means updating the size of the memory file and
   * should only be done if everything has been written into the buffer
   * Our shared memory readers will check for this value to change
   */
  public commit() {
    this.currentSize += this.uncommittedSize
    this.uncommittedSize = 0
    this.memHeaderWrapper.size = BigInt(this.currentSize)
  }

  /**
   * Set the mode of the Pool
   * not active Pool will yield new Buffers instead of slices
   * from its buffers
   */
  public setActive(active: boolean) {
    this.active = active
  }

  /**
   * Get a slice for a given size
   */
  public sliceSize(size: number): Buffer {
    if (!this.active) {
      return Buffer.alloc(size)
    }

    // get the slice
    const buffer = this.currentBuffer.slice(
      this.index + MESSAGE_HEADER_SIZE,
      this.index + MESSAGE_HEADER_SIZE + size
    )

    // write the actual size
    const sizeWithFrame = size + (2 * MESSAGE_HEADER_SIZE)
    this.currentBuffer.writeUInt16LE(sizeWithFrame, this.index)
    this.currentBuffer.writeUInt16LE(sizeWithFrame, this.index + MESSAGE_HEADER_SIZE + size)

    this.index += sizeWithFrame
    this.uncommittedSize += sizeWithFrame
    if (this.index >= this.bufferLength) {
      // update indexes
      this.index -= this.bufferLength
      this.bufferIndex++
      this.currentBuffer = this.buffers[this.bufferIndex]
    }

    return buffer
  }

  /**
   * get a slice for a given Bendec type
   */
  public slice(name: string): Buffer {
    return this.sliceSize(this.bendec.getSize(name))
  }

  /**
   * Get a slice of this delicious cake
   * and wrap it up
   */
  public wrap(name: string): BufferWrapper<T> {
    return this.bendec.wrap(name, this.slice(name))
  }

  /**
   * Get status of the Pool
   */
  public getStatus(): [number, number] {
    return [this.bufferIndex, this.index]
  }

  /**
   * get current committed and uncommitted size
   */
  public getSize(): [number, number] {
    return [this.currentSize, this.uncommittedSize]
  }

  public isUsed(): boolean {
    return this.currentSize > Number(this.memHeaderWrapper.dataOffset)
  }
}

export { Pool }
