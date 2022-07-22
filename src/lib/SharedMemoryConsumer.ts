import { Pool } from './Pool'
import { SharedMemory, SharedMemoryConfig } from './SharedMemory'
import { ShmItem, SharedMemoryIterator } from './SharedMemoryIterator'
import { Observable, of, concat, interval } from 'rxjs'
import { filter, map, share } from 'rxjs/operators'

class SharedMemoryConsumer {
  private sharedMemory: SharedMemory
  private buffers: Buffer[]

  constructor(config: SharedMemoryConfig) {
    this.sharedMemory = new SharedMemory(config)
    this.buffers = this.sharedMemory.getBuffers()
  }

  /**
   * Full stream of data with initial data and updates in one Observable
   */
  public getAll(pollInterval: number = 10): Observable<Iterable<ShmItem>> {
    let currentIndex = Pool.HEADER_SIZE
    const endIndex = Math.max(this.getSize(), Pool.HEADER_SIZE)

    const shmIter = new SharedMemoryIterator(
      this.sharedMemory,
      currentIndex,
      endIndex
    )
    const currentData$ = of(shmIter)

    currentIndex = endIndex

    return concat(
      currentData$,
      interval(pollInterval).pipe(
        filter(() => this.getSize() > currentIndex),
        map(() => {
          const end = this.getSize()
          const iterator = new SharedMemoryIterator(
            this.sharedMemory,
            currentIndex,
            end
          )
          currentIndex = end
          return iterator
        }),
        share()
      )
    )
  }

  public getData(fromIndex: number = Pool.HEADER_SIZE) {
    return new SharedMemoryIterator(this.sharedMemory, fromIndex)
  }

  private getSize(): number {
    return (
      this.buffers[0].readUInt32LE(0) +
      this.buffers[0].readUInt32LE(4) * 0x100000000
    )
  }
}

export { SharedMemoryConsumer }
