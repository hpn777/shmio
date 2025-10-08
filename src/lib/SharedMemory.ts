import { openSync, ftruncateSync, constants } from 'fs'

const { O_RDONLY, O_RDWR, O_CREAT, O_EXCL, O_NOFOLLOW } = constants

enum Protection {
  PROT_NONE = 0,
  PROT_READ = 1,
  PROT_WRITE = 2,
  PROT_EXEC = 4,
}

enum Flags {
  MAP_SHARED = 1,
  MAP_PRIVATE = 2,
}

interface MMap {
  setup(
    size: number,
    num: number,
    overlap: number,
    protection: Protection,
    flags: Flags,
    fd: number,
  ): Buffer[]
}

/* tslint:disable-next-line:no-var-requires */
const mmap: MMap = require('../../build/Release/mmap')

/**
 * Append only shared memory
 *
 * This chunk of shared memory is managed by Pool
 *
 * The data will be written directly by whoever owns the shared Buffer
 * In our case it's Matcher -> Pool -> Buffer
 */
class SharedMemory {
  // all shared memory buffers
  private buffers: Buffer[]
  private config: SharedMemoryConfig

  constructor(config: SharedMemoryConfig) {
    this.buffers = this.setup(config)
    this.config = config
  }

  /**
   * returns storage buffers of this shared memory
   */
  public getBuffers(): Buffer[] {
    return this.buffers
  }

  public getConfig(): SharedMemoryConfig {
    return this.config
  }

  private setup(config: SharedMemoryConfig): Buffer[] {

    const permissions = 0o664

    const flags = config.writable
      ? O_RDWR
      : O_RDONLY

    let fd

    try {
      fd = openSync(config.path, flags, permissions)
    } catch (e) {
      if (!config.writable) {
        throw new Error(`File does not exist and writable = false, path: ${config.path}`)
      }

      fd = openSync(config.path, O_RDWR | O_CREAT, permissions)
      // only truncate if new - size matches mmap allocation (size * num)
      // Note: overlap is handled within buffers, not in file size
      ftruncateSync(fd, config.size * config.num)
    }

    const protection = config.writable
      ? Protection.PROT_READ | Protection.PROT_WRITE
      : Protection.PROT_READ

    return mmap.setup(
      config.size,
      config.num,
      config.overlap,
      protection,
      Flags.MAP_SHARED,
      fd,
    )
  }
}

interface SharedMemoryConfig {
  // if the path is in /dev/shm/ it's a shared memory
  // otherwise it's a memory mapped file
  path: string
  // size of one chunk
  size: number
  // number of chunks
  num: number
  // overlap
  overlap: number
  // mapping as writable
  writable: boolean
}

export { SharedMemory, SharedMemoryConfig, MMap, mmap }
