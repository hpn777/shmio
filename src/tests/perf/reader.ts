import { createSharedLog } from '../../lib/SharedLog'

const logPath = '/dev/shm/perf-bench-reader'
const iterations = 1_000_000
const payloadSize = 64 // bytes

interface Result {
  iterations: number
  payloadSize: number
  durationMs: number
  throughputEventsPerSec: number
  throughputMBsPerSec: number
  avgLatencyMicros: number
}

async function runReaderBench(): Promise<Result> {
  const { promises: fs } = await import('fs')

  // Clean up any previous run
  await fs.unlink(logPath).catch(() => undefined)

  // Pre-populate the shared log
  const bufferSize = 512n * 1024n * 1024n // 512 MiB
  const writerLog = createSharedLog({
    path: logPath,
    capacityBytes: bufferSize,
    writable: true,
  })

  const writer = writerLog.writer!
  for (let i = 0; i < iterations; i++) {
    const frame = writer.allocate(payloadSize)
    frame.fill(0xEF)
    writer.commit()
  }

  writerLog.close()

  // Open as reader and benchmark iteration
  const readerLog = createSharedLog({
    path: logPath,
    writable: false,
  })

  const iterator = readerLog.createIterator()

  const startTime = process.hrtime.bigint()

  let framesRead = 0
  let batch = iterator.nextBatch({ maxMessages: 10000 })
  while (batch.length > 0 && framesRead < iterations) {
    framesRead += batch.length
    batch = iterator.nextBatch({ maxMessages: 10000 })
  }

  const endTime = process.hrtime.bigint()
  const durationNanos = endTime - startTime
  const durationMs = Number(durationNanos) / 1_000_000

  iterator.close()
  readerLog.close()

  await fs.unlink(logPath)

  const totalBytes = framesRead * payloadSize
  const throughputEventsPerSec = framesRead / (durationMs / 1000)
  const throughputMBsPerSec = (totalBytes / (1024 * 1024)) / (durationMs / 1000)
  const avgLatencyMicros = (durationNanos / BigInt(framesRead)) / 1000n

  return {
    iterations: framesRead,
    payloadSize,
    durationMs,
    throughputEventsPerSec,
    throughputMBsPerSec,
    avgLatencyMicros: Number(avgLatencyMicros),
  }
}

async function main() {
  console.log('=== shmio Reader Performance Benchmark ===\n')

  const result = await runReaderBench()

  console.log(`Frames Read:        ${result.iterations.toLocaleString()}`)
  console.log(`Payload Size:       ${result.payloadSize} bytes`)
  console.log(`Total Duration:     ${result.durationMs.toFixed(2)} ms`)
  console.log(`\nThroughput:`)
  console.log(`  ${result.throughputEventsPerSec.toLocaleString(undefined, { maximumFractionDigits: 0 })} events/sec`)
  console.log(`  ${result.throughputMBsPerSec.toFixed(2)} MB/sec`)
  console.log(`\nLatency:`)
  console.log(`  ${result.avgLatencyMicros.toFixed(3)} µs/event (avg)`)
}

main().catch(console.error)
