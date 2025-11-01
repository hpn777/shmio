import { getBendec, MemHeader } from './memHeader'
import type { ShmIterator, ShmWriter, OpenSharedLogOptions } from './native/types'
import { openSharedLog } from './native'

const mhBendec = getBendec()

interface WritableSharedLogOptions {
  path: string
  capacityBytes: number | bigint
  writable: true
  debugChecks?: boolean
}

interface ReadonlySharedLogOptions {
  path: string
  writable: false
  capacityBytes?: number | bigint
  debugChecks?: boolean
}

export type SharedLogOptions = WritableSharedLogOptions | ReadonlySharedLogOptions

export interface SharedLog {
  header: MemHeader
  createIterator: (options?: { startCursor?: bigint }) => ShmIterator
  writer?: ShmWriter
  close(): void
}

export const createSharedLog = (options: SharedLogOptions): SharedLog => {
  const capacityBigInt = options.capacityBytes !== undefined
    ? (typeof options.capacityBytes === 'bigint'
      ? options.capacityBytes
      : BigInt(options.capacityBytes))
    : undefined

  const openOptions: OpenSharedLogOptions = {
    path: options.path,
    writable: options.writable,
    debugChecks: options.debugChecks ?? false,
  }

  if (capacityBigInt !== undefined) {
    openOptions.capacityBytes = capacityBigInt
  }

  const handle = openSharedLog(openOptions)

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
