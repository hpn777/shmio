import assert from 'assert'
import { Bendec, BufferWrapper } from 'bendec'

// generic default
// TODO: never default generic to any!
// we need union from Bendec to be generated
type PoolType = any

/**
 * The size of the shared memory header
 * u64 - 8 bytes
 * this is actual [u32-low, u32-high] as nodejs can't handle u64s
 * so the number 0x0102030405060708 will be represented in bytes as:
 * [x01, x02, x03, x04, x05, x06, x07, x08]
 *
 */
const HEADER_SIZE: number = 8

/**
 * each message is prepended by the header
 * [u32][message]
 * first 4 bytes - size of message
 */
const MESSAGE_HEADER_SIZE: number = 2

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

  /**
   * Create a Pool with provided Buffers
   */
  public static withBuffers<T>(
    bendec: Bendec<T>,
    buffers: Buffer[],
    overlap: number,
    restore: boolean = true
  ) {
    return new Pool(bendec, buffers, overlap, restore)
  }

  /**
   * Create a Pool with fixed size Buffer
   */
  public static withSize<T>(bendec: Bendec<T>, size: number): Pool<T> {
    return new Pool(bendec, [Buffer.alloc(size)], 0)
  }

  public bendec: Bendec<T>

  // at start we're skipping the header size
  private index: number = HEADER_SIZE
  private bufferIndex: number = 0
  // reference to the current Buffer
  private currentBuffer: Buffer
  private buffers: Buffer[]
  private bufferLength: number
  // the first header bytes
  private sizeBuffer: Buffer
  // this is an overlap between pages
  private overlap: number
  private uncommittedSize: number = 0
  // current size of the shared memory
  private currentSize: number = HEADER_SIZE
  private active: boolean = true

  private constructor(
    bendec: Bendec<T>,
    buffers: Buffer[],
    overlap: number,
    // if true we will rebuild this Pool from existing sharedMemory
    restore: boolean = true
  ) {
    this.bendec = bendec
    this.buffers = buffers
    this.overlap = overlap
    this.bufferLength = buffers[0].length - overlap
    this.sizeBuffer = this.buffers[0].slice(0, HEADER_SIZE)
    this.currentBuffer = this.buffers[0]

    if (restore) {
      this.currentSize =
        this.buffers[0].readUInt32LE(0) +
        this.buffers[0].readUInt32LE(4) * 0x100000000
      if (this.currentSize === 0) {
        this.currentSize = HEADER_SIZE
      }
      this.index = this.currentSize % this.bufferLength
      this.bufferIndex = Math.floor(this.currentSize / this.bufferLength)
      this.currentBuffer = this.buffers[this.bufferIndex]
    }

    assert(buffers[0].length >= 32, 'Buffers must be at least 32 bytes')

    // Make sure all buffers have the same size
    assert(
      buffers.reduce(
        (r, buffer) => r && buffer.length === buffers[0].length,
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
    const big = ~~(this.currentSize / 0x0100000000)
    this.sizeBuffer.writeUInt32LE(this.currentSize % 0x0100000000, 0)
    this.sizeBuffer.writeUInt32LE(big, 4)
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
    this.currentBuffer.writeUInt32LE(size, this.index)

    this.index += MESSAGE_HEADER_SIZE + size
    this.uncommittedSize += size + MESSAGE_HEADER_SIZE

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
    return this.currentSize > Pool.HEADER_SIZE
  }
}

export { Pool }
