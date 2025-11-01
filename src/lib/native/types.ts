export const DEFAULT_MAX_MESSAGES = 64
export const DEFAULT_MAX_BYTES = 256 * 1024

export interface NextBatchOptions {
  /**
   * Upper bound on number of frames returned from a single batch.
   * Defaults to 64 when omitted.
   */
  maxMessages?: number
  /**
   * Upper bound on cumulative bytes consumed by a batch (including 4 bytes of
   * metadata per frame). Defaults to 256 KiB when omitted.
   */
  maxBytes?: number
  /**
   * Enables defensive validation of frame prefixes/suffixes. When enabled the
   * iterator throws ERR_SHM_FRAME_CORRUPT on mismatch.
   */
  debugChecks?: boolean
}

export interface ShmIteratorMetrics {
  framesSeen: number
  framesReturned: number
  emptyBatches: number
  nonEmptyBatches: number
  errors: Partial<Record<ShmIteratorErrorCode, number>>
}

export type ShmIteratorErrorCode =
  | 'ERR_SHM_ITERATOR_CLOSED'
  | 'ERR_SHM_CURSOR'
  | 'ERR_SHM_FRAME_CORRUPT'
  | 'ERR_SHM_MAPPING_GONE'

export interface ShmIterator {
  next(): Buffer | null
  nextBatch(options?: NextBatchOptions): Buffer[]
  cursor(): bigint
  committedSize(): bigint
  seek(position: bigint): void
  close(): void
}

export interface ShmIteratorConstructor {
  new (base: Buffer, length: bigint, startCursor?: bigint): ShmIterator
}

export interface ShmIteratorAddon {
  ShmIterator: ShmIteratorConstructor
  openSharedLog?: (options: OpenSharedLogOptions) => NativeSharedLogHandle
}

export interface ShmWriter {
  allocate(size: number, options?: { debugChecks?: boolean }): Buffer
  commit(): void
  close(): void
}

export interface NativeSharedLogHandle {
  headerView(): Buffer
  createIterator(options?: { startCursor?: bigint }): ShmIterator
  createWriter(options?: { debugChecks?: boolean }): ShmWriter
  close(): void
}

export interface OpenSharedLogOptions {
  path: string
  writable: boolean
  capacityBytes?: bigint
  debugChecks?: boolean
}

export const isShmIteratorError = (error: unknown): error is NodeJS.ErrnoException & {
  code: ShmIteratorErrorCode
} => {
  if (typeof error !== 'object' || error === null) {
    return false
  }

  const code = (error as any).code
  return code === 'ERR_SHM_ITERATOR_CLOSED'
    || code === 'ERR_SHM_CURSOR'
    || code === 'ERR_SHM_FRAME_CORRUPT'
    || code === 'ERR_SHM_MAPPING_GONE'
}
