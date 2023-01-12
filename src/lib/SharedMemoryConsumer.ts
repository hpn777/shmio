import { SharedMemory } from './SharedMemory'
import { ShmItem, SharedMemoryIterator } from './SharedMemoryIterator'
import { Observable, of, concat, interval } from 'rxjs'
import { filter, map, share } from 'rxjs/operators'
import { getBendec } from './memHeader'

class SharedMemoryConsumer {
  private buffers: Buffer[]
  private dataOffset: number
  private memHeaderWrapper: any

  constructor(private sharedMemory: SharedMemory,) {
    this.buffers = sharedMemory.getBuffers()

    const mhBendec = getBendec()
    this.memHeaderWrapper = mhBendec.getWrapper('MemHeader')
    this.memHeaderWrapper.setBuffer(this.buffers[0])
    this.dataOffset = Number(this.memHeaderWrapper.dataOffset)
  }

  /**
   * Full stream of data with initial data and updates in one Observable
   */
  public getAll(pollInterval: number = 10): Observable<Iterable<ShmItem>> {
    let currentIndex = this.dataOffset
    const endIndex = Math.max(this.getSize(), this.dataOffset)

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


  public getData(fromIndex: number = this.dataOffset) {
    const buffers = this.sharedMemory.getBuffers()
    return new SharedMemoryIterator(this.sharedMemory, fromIndex, this.getSize())
  }

  private getSize(): number {
    return Number(this.memHeaderWrapper.size)
  }
}

export { SharedMemoryConsumer }
