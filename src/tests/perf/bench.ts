#!/usr/bin/env node

import { createSharedLog } from '../../lib/SharedLog'
import { promises as fs } from 'fs'

// Benchmark configuration
const BENCH_PATH = '/dev/shm/shmio-bench'
const BUFFER_SIZE = 512n * 1024n * 1024n // 512 MiB
const PAYLOAD_SIZES = [16, 64, 256, 1024]
const ITERATIONS = 100_000

interface BenchmarkResult {
  payloadSize: number
  iterations: number
  durationMs: number
  eventsPerSec: number
  throughputMBsPerSec: number
  latencyMicros: number
  latencyNanos: number
}

async function benchmarkWrite(payloadSize: number, iterations: number): Promise<BenchmarkResult> {
  // Clean up
  await fs.unlink(BENCH_PATH).catch(() => undefined)

  const log = createSharedLog({
    path: BENCH_PATH,
    capacityBytes: BUFFER_SIZE,
    writable: true,
  })

  const writer = log.writer!
  const payload = Buffer.alloc(payloadSize)

  // Warm up
  for (let i = 0; i < 1000; i++) {
    const frame = writer.allocate(payloadSize)
    payload.copy(frame as any)
    writer.commit()
  }

  log.close()
  await fs.unlink(BENCH_PATH)

  // Actual benchmark
  const benchLog = createSharedLog({
    path: BENCH_PATH,
    capacityBytes: BUFFER_SIZE,
    writable: true,
  })

  const benchWriter = benchLog.writer!
  const start = process.hrtime.bigint()

  for (let i = 0; i < iterations; i++) {
    const frame = benchWriter.allocate(payloadSize)
    payload.copy(frame as any)
    benchWriter.commit()
  }

  const end = process.hrtime.bigint()
  benchLog.close()
  await fs.unlink(BENCH_PATH)

  const durationNanos = end - start
  const durationMs = Number(durationNanos) / 1_000_000
  const totalBytes = iterations * payloadSize
  const eventsPerSec = iterations / (durationMs / 1000)
  const throughputMBsPerSec = (totalBytes / (1024 * 1024)) / (durationMs / 1000)
  const latencyNanos = durationNanos / BigInt(iterations)
  const latencyMicros = Number(latencyNanos) / 1000

  return {
    payloadSize,
    iterations,
    durationMs,
    eventsPerSec,
    throughputMBsPerSec,
    latencyMicros,
    latencyNanos: Number(latencyNanos),
  }
}

async function benchmarkRead(iterations: number): Promise<BenchmarkResult> {
  // Pre-populate
  await fs.unlink(BENCH_PATH).catch(() => undefined)

  const writerLog = createSharedLog({
    path: BENCH_PATH,
    capacityBytes: BUFFER_SIZE,
    writable: true,
  })

  const writer = writerLog.writer!
  const payload = Buffer.alloc(64)

  for (let i = 0; i < iterations; i++) {
    const frame = writer.allocate(64)
    payload.copy(frame as any)
    writer.commit()
  }

  writerLog.close()

  // Benchmark read
  const readerLog = createSharedLog({
    path: BENCH_PATH,
    writable: false,
  })

  const iterator = readerLog.createIterator()
  const start = process.hrtime.bigint()

  let framesRead = 0
  let batch = iterator.nextBatch({ maxMessages: 10000 })
  while (batch.length > 0) {
    framesRead += batch.length
    batch = iterator.nextBatch({ maxMessages: 10000 })
  }

  const end = process.hrtime.bigint()
  iterator.close()
  readerLog.close()

  await fs.unlink(BENCH_PATH)

  const durationNanos = end - start
  const durationMs = Number(durationNanos) / 1_000_000
  const totalBytes = framesRead * 64
  const eventsPerSec = framesRead / (durationMs / 1000)
  const throughputMBsPerSec = (totalBytes / (1024 * 1024)) / (durationMs / 1000)
  const latencyNanos = durationNanos / BigInt(framesRead)
  const latencyMicros = Number(latencyNanos) / 1000

  return {
    payloadSize: 64,
    iterations: framesRead,
    durationMs,
    eventsPerSec,
    throughputMBsPerSec,
    latencyMicros,
    latencyNanos: Number(latencyNanos),
  }
}

function formatResult(label: string, result: BenchmarkResult) {
  console.log(`\n${label}`)
  console.log('─'.repeat(70))
  console.log(`Iterations:        ${result.iterations.toLocaleString()}`)
  console.log(`Payload Size:      ${result.payloadSize} bytes`)
  console.log(`Total Duration:    ${result.durationMs.toFixed(2)} ms`)
  console.log(`\nThroughput:`)
  console.log(`  ${result.eventsPerSec.toLocaleString(undefined, { maximumFractionDigits: 0 })} events/sec`)
  console.log(`  ${result.throughputMBsPerSec.toFixed(2)} MB/sec`)
  console.log(`\nLatency:`)
  console.log(`  ${result.latencyMicros.toFixed(3)} µs/event`)
  console.log(`  ${result.latencyNanos} ns/event`)
}

async function main() {
  console.log('\n' + '═'.repeat(70))
  console.log('                 shmio Performance Benchmark')
  console.log('═'.repeat(70))

  console.log('\n📝 WRITE PERFORMANCE (1 write + 1 commit = 1 event)')
  for (const size of PAYLOAD_SIZES) {
    const result = await benchmarkWrite(size, ITERATIONS)
    formatResult(`Payload Size: ${size} bytes`, result)
  }

  console.log('\n\n📖 READ PERFORMANCE')
  const readResult = await benchmarkRead(ITERATIONS)
  formatResult('Reading 100k events (batched)', readResult)

  console.log('\n' + '═'.repeat(70))
  console.log('Benchmark complete!')
  console.log('═'.repeat(70) + '\n')
}

main().catch(console.error)
