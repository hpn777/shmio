import { getBendec, MemHeader } from './memHeader'
import type { ShmIterator, ShmWriter } from './native/types'
import { openSharedLog } from './native'

const mhBendec = getBendec()

export interface SharedLogOptions {
  path: string
  capacityBytes: number | bigint
  writable: boolean
  debugChecks?: boolean
}

export interface SharedLog {
  header: MemHeader
  createIterator: (options?: { startCursor?: bigint }) => ShmIterator
  writer?: ShmWriter
  close(): void
}

export const createSharedLog = (options: SharedLogOptions): SharedLog => {
  const capacityBigInt = typeof options.capacityBytes === 'bigint'
    ? options.capacityBytes
    : BigInt(options.capacityBytes)

  const handle = openSharedLog({
    path: options.path,
    capacityBytes: capacityBigInt,
    writable: options.writable,
    debugChecks: options.debugChecks ?? false,
  })

  const headerBuffer = handle.headerView()
  const headerWrapper = mhBendec.getWrapper('MemHeader') as MemHeader
  headerWrapper.setBuffer(headerBuffer)

  const createIterator = (iteratorOptions?: { startCursor?: bigint }) => {
    const startCursor = iteratorOptions?.startCursor
    if (startCursor !== undefined) {
      return handle.createIterator({ startCursor })
    }
    return handle.createIterator()
  }

  const writer = options.writable
    ? handle.createWriter({ debugChecks: options.debugChecks ?? false })
    : undefined

  return {
    header: headerWrapper,
    createIterator,
    writer,
    close: () => handle.close(),
  }
}
