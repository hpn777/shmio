import { createSharedLog } from '../../lib/SharedLog'

const logPath = '/dev/shm/perf-bench-writer'
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

async function runWriterBench(): Promise<Result> {
  const { promises: fs } = await import('fs')

  // Clean up any previous run
  await fs.unlink(logPath).catch(() => undefined)

  // Create log with sufficient capacity
  const bufferSize = 512n * 1024n * 1024n // 512 MiB
  const log = createSharedLog({
    path: logPath,
    capacityBytes: bufferSize,
    writable: true,
  })

  const writer = log.writer!
  const payload = Buffer.alloc(payloadSize)

  // Warm up
  const warmupSize = 10000
  for (let i = 0; i < warmupSize; i++) {
    const frame = writer.allocate(payloadSize)
    frame.fill(0xAB)
  }
  writer.commit()

  // Reset for actual benchmark
  log.close()
  await fs.unlink(logPath)

  // Re-open for benchmark
  const benchLog = createSharedLog({
    path: logPath,
    capacityBytes: bufferSize,
    writable: true,
  })

  const benchWriter = benchLog.writer!
  const startTime = process.hrtime.bigint()

  for (let i = 0; i < iterations; i++) {
    const frame = benchWriter.allocate(payloadSize)
    frame.fill(0xCD)
    benchWriter.commit()
  }

  const endTime = process.hrtime.bigint()
  const durationNanos = endTime - startTime
  const durationMs = Number(durationNanos) / 1_000_000

  benchLog.close()
  await fs.unlink(logPath)

  const totalBytes = iterations * payloadSize
  const throughputEventsPerSec = iterations / (durationMs / 1000)
  const throughputMBsPerSec = (totalBytes / (1024 * 1024)) / (durationMs / 1000)
  const avgLatencyMicros = (durationNanos / BigInt(iterations)) / 1000n

  return {
    iterations,
    payloadSize,
    durationMs,
    throughputEventsPerSec,
    throughputMBsPerSec,
    avgLatencyMicros: Number(avgLatencyMicros),
  }
}

async function main() {
  console.log('=== shmio Writer Performance Benchmark ===\n')

  const result = await runWriterBench()

  console.log(`Iterations:         ${result.iterations.toLocaleString()}`)
  console.log(`Payload Size:       ${result.payloadSize} bytes`)
  console.log(`Total Duration:     ${result.durationMs.toFixed(2)} ms`)
  console.log(`\nThroughput:`)
  console.log(`  ${result.throughputEventsPerSec.toLocaleString(undefined, { maximumFractionDigits: 0 })} events/sec`)
  console.log(`  ${result.throughputMBsPerSec.toFixed(2)} MB/sec`)
  console.log(`\nLatency:`)
  console.log(`  ${result.avgLatencyMicros.toFixed(3)} µs/event (avg)`)
}

main().catch(console.error)
