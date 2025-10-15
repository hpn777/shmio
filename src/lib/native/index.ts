import path from 'path'
import type {
  ShmIteratorAddon,
  ShmIteratorConstructor,
  OpenSharedLogOptions,
  NativeSharedLogHandle,
} from './types'

let cachedAddon: ShmIteratorAddon | null = null

const loadAddon = (): ShmIteratorAddon => {
  if (cachedAddon) {
    return cachedAddon
  }

  const bindingPath = path.join(__dirname, '..', '..', '..', 'build', 'Release', 'mmap')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const addon = require(bindingPath) as ShmIteratorAddon
  if (typeof addon.ShmIterator !== 'function') {
    throw new Error('Native addon missing ShmIterator constructor')
  }

  cachedAddon = addon
  return addon
}

export const getShmIteratorConstructor = (): ShmIteratorConstructor => {
  const { ShmIterator } = loadAddon()
  return ShmIterator
}

export const openSharedLog = (options: OpenSharedLogOptions): NativeSharedLogHandle => {
  const addon = loadAddon()
  if (typeof addon.openSharedLog !== 'function') {
    throw new Error('Native addon missing openSharedLog factory')
  }
  return addon.openSharedLog(options)
}

export * from './types'
