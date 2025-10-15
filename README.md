# shmio

High-performance shared memory library for Node.js with append-only log semantics, designed for event sourcing and inter-process communication.

## Features

- Memory-mapped files with automatic buffer management
- Append-only log with atomic commits
- Symmetric frame headers for bidirectional iteration
- Zero-copy frame access and mutation
- Native N-API iterator with configurable batch reads
- Single writer / multi-reader concurrency model
- Optional debug checks with zero production overhead
- TypeScript support with full type definitions
- Built-in Claude Sonet agent for low-latency prompt dispatching

## Installation

```bash
npm install shmio
```

## Quick Start

### Writer Process

```typescript
import { createSharedLog } from 'shmio'
import { Bendec } from 'bendec'

const bendec = new Bendec({
  types: [{
    name: 'LogEvent',
    fields: [
      { name: 'timestamp', type: 'u64' },
      { name: 'level', type: 'u8' },
      { name: 'message', type: 'string' },
    ],
  }],
})

const log = createSharedLog({
  path: '/dev/shm/myapp-events',
  capacityBytes: 16n * 1024n * 1024n, // 16 MiB
  writable: true,
  debugChecks: process.env.SHMIO_DEBUG === 'true',
})

const writer = log.writer!

const frameSize = bendec.getSize('LogEvent')
const frame = writer.allocate(frameSize)
bendec.encodeAs({
  timestamp: BigInt(Date.now()),
  level: 1,
  message: 'Application started',
}, 'LogEvent', frame)

writer.commit()
log.close()
```

### Reader Process

```typescript
import { createSharedLog } from 'shmio'
import { Bendec } from 'bendec'

const bendec = new Bendec({ /* same schema as writer */ })

const log = createSharedLog({
  path: '/dev/shm/myapp-events',
  capacityBytes: 16n * 1024n * 1024n,
  writable: false,
})

const iterator = log.createIterator()

const batch = iterator.nextBatch({ maxMessages: 32 })
for (const buffer of batch) {
  const event = bendec.decodeAs(buffer, 'LogEvent')
  console.log(event)
}

iterator.close()
log.close()
```

## API

### `createSharedLog(options)`

Creates (or opens) a memory-mapped append-only log. Options:

```typescript
createSharedLog({
  path: string,                   // File path (/dev/shm/name for shared memory)
  capacityBytes: number | bigint, // Desired file size when creating; existing files reuse their current size
  writable: boolean,              // Enable writer support
  debugChecks?: boolean,          // Optional integrity checks for writer + iterator
})
```

Returns a `SharedLog` with:

- `header` &mdash; a mutable Bendec wrapper exposing `headerSize`, `dataOffset`, and the current `size` cursor.
- `createIterator(options?)` &mdash; opens a new native iterator. Pass `{ startCursor: bigint }` to resume from a stored position.
- `writer` &mdash; available when `writable: true`. Use it to append frames atomically.
- `close()` &mdash; release the underlying file descriptor and mapping.

### `ShmIterator`

Native iterator instances returned by `createIterator()` expose:

- `next()` &mdash; returns the next frame as a `Buffer`, or `null` when no new data is committed.
- `nextBatch({ maxMessages, maxBytes, debugChecks })` &mdash; pulls multiple frames in one call.
- `cursor()` &mdash; current read cursor (as `bigint`). Persist this to resume later.
- `committedSize()` &mdash; total number of committed bytes visible to readers.
- `seek(position)` &mdash; jump to an absolute cursor position.
- `close()` &mdash; release underlying native resources.

### `ShmWriter`

When the log is writable, `log.writer` exposes:

- `allocate(size, { debugChecks })` &mdash; reserves a frame buffer for writing.
- `commit()` &mdash; atomically publishes all allocated frames since the previous commit.
- `close()` &mdash; releases writer resources.

See the [Claude Sonet agent documentation](docs/claude-sonet-agent.md) for a complete example using `nextBatch` and live batching policies.

## Claude Sonet Agent

`shmio` ships with an optional Claude Sonet agent that consumes shared-log frames via the native iterator, enforces batching/TTL policies, and forwards prompts to Claude Sonet with rich metrics. Use the helper factory to wire it up:

```typescript
import { createSharedLog } from 'shmio'
import { createClaudeSonetAgent } from 'shmio/dist/agent'

const sharedLog = createSharedLog({
  path: '/dev/shm/sonet-log',
  capacityBytes: 32n * 1024n * 1024n,
  writable: false,
})

const agent = createClaudeSonetAgent({
  sharedLog,
  model: 'claude-3-5-sonet',
  decoder: buffer => ({ ok: true, frame: { payload: JSON.parse(buffer.toString()), raw: buffer } }),
  claudeClient: { sendPrompt: async input => ({ requestId: 'demo', latencyMs: 0, raw: null }) },
})

agent.start()
```

Configuration details, metrics, and rollout guidance live in [docs/claude-sonet-agent.md](docs/claude-sonet-agent.md).

## Architecture

### Buffer Overlap

JavaScript has buffer size limitations (~1GB). shmio overcomes this by creating multiple overlapping buffers:

```
Buffer 0: [0 ................ size]
                    [overlap]
Buffer 1:         [size ................ 2*size]
                            [overlap]
Buffer 2:                  [2*size ................ 3*size]
```

Messages that span buffer boundaries are guaranteed to fit completely in at least one buffer due to the overlap.

### Frame Structure

Each message has symmetric headers for bidirectional iteration:

```
┌─────────────┬──────────────────┬─────────────┐
│ Leading u16 │   Message Data   │ Trailing u16│
│   (size)    │  (variable len)  │   (size)    │
└─────────────┴──────────────────┴─────────────┘
     2 bytes        N bytes           2 bytes
```

Both size fields contain the total frame size (N + 4 bytes). This enables:
- Forward iteration (read leading size, skip forward)
- Backward iteration (read trailing size, skip backward)
- Integrity validation (compare both sizes)

### Memory Layout

```
┌──────────────────────────────────────────────────────┐
│ Header (24 bytes)                                     │
│ - headerSize: u64                                     │
│ - dataOffset: u64                                     │
│ - size: u64 (current cursor, updated on commit)      │
├──────────────────────────────────────────────────────┤
│ Event 1: [u16 size][data][u16 size]                 │
├──────────────────────────────────────────────────────┤
│ Event 2: [u16 size][data][u16 size]                 │
├──────────────────────────────────────────────────────┤
│ ...                                                   │
└──────────────────────────────────────────────────────┘
```

## Concurrency Model

**Single Writer, Multiple Readers**

- ONE writer process can call `writer.commit()` &mdash; multiple writers will corrupt data
- MULTIPLE reader processes can read concurrently via independent iterators
- NO explicit locking &mdash; relies on atomic 64-bit writes on x86/x64

Writers must:
1. Allocate a frame with `writer.allocate(size)`
2. Encode the frame payload (e.g., via Bendec)
3. Call `writer.commit()` to make events visible atomically

Readers see:
- Consistent snapshots (all events up to last commit)
- Never see partial events

## Debug Mode

Enable comprehensive frame validation during development:

```bash
# Enable debug mode
SHMIO_DEBUG=true node your-app.js

# Run tests with validation
SHMIO_DEBUG=true npm test
```

Debug mode validates:
- Frame size sanity (must be 4 bytes to buffer size)
- Symmetric frame integrity (leading size == trailing size)
- Position-aware validation (avoids false positives)

**Performance:** Zero overhead in production (disabled by default), ~2-5% overhead when enabled.

See [DEBUG.md](DEBUG.md) for complete documentation.

## Use Cases

### Event Sourcing

Perfect for append-only event logs:

```typescript
// Writer: Event producer
const path = '/dev/shm/event-log'
const bendec = createEventBendec() // your Bendec schema helper
const writerLog = createSharedLog({ path, capacityBytes: 64n * 1024n * 1024n, writable: true })
const messageSize = bendec.getSize('Event')

function recordEvent(type: string, data: Buffer) {
  const frame = writerLog.writer!.allocate(messageSize)
  bendec.encodeAs({
    type,
    timestamp: BigInt(Date.now()),
    data,
  }, 'Event', frame)
  writerLog.writer!.commit()
}

// Reader: Event consumer
const readerLog = createSharedLog({ path, capacityBytes: 64n * 1024n * 1024n, writable: false })
const iterator = readerLog.createIterator()
for (const buffer of iterator.nextBatch({ maxMessages: 32 })) {
  const event = bendec.decodeAs(buffer, 'Event')
  processEvent(event)
}
```

### System Monitoring

Real-time log streaming between processes:

```typescript
// Logger process
const path = '/dev/shm/log-stream'
const bendec = createLogBendec()
const writerLog = createSharedLog({ path, capacityBytes: 32n * 1024n * 1024n, writable: true })
const writer = writerLog.writer!

function logEntry(level: number, message: string) {
  const frame = writer.allocate(bendec.getSize('LogEntry'))
  bendec.encodeAs({
    timestamp: BigInt(Date.now()),
    level,
    message,
  }, 'LogEntry', frame)
  writer.commit()
}

// Monitor process
const readerLog = createSharedLog({ path, capacityBytes: 32n * 1024n * 1024n, writable: false })
const iterator = readerLog.createIterator()
for (const buffer of iterator.nextBatch({ maxMessages: 100 })) {
  const entry = bendec.decodeAs(buffer, 'LogEntry')
  console.log(`[${entry.level}] ${entry.message}`)
}
```

### Inter-Process Communication

High-speed message passing:

```typescript
// Producer
const path = '/dev/shm/ipc-channel'
const bendec = createMessageBendec()
const producerLog = createSharedLog({ path, capacityBytes: 8n * 1024n * 1024n, writable: true })
const writer = producerLog.writer!

for (let i = 0; i < 1000; i++) {
  const frame = writer.allocate(bendec.getSize('Message'))
  bendec.encodeAs({
    id: i,
    payload: generateData(),
  }, 'Message', frame)
}
writer.commit()  // Batch commit for performance

// Consumer
const consumerLog = createSharedLog({ path, capacityBytes: 8n * 1024n * 1024n, writable: false })
const iterator = consumerLog.createIterator()
for (const buffer of iterator.nextBatch()) {
  const msg = bendec.decodeAs(buffer, 'Message')
  process(msg)
}
```

## Performance

### Benchmarks

On modern hardware (Intel i7, NVMe SSD):

- Write throughput: ~2-5 million events/second
- Read throughput: ~10-20 million events/second
- Latency: <100ns per event (zero-copy)

### Best Practices

1. **Batch commits** - Group multiple writes before calling `commit()`
2. **Size buffers appropriately** - Balance memory usage vs overflow handling
3. **Use overlap wisely** - Should be >= your largest message size
4. **Monitor memory** - Check `getSize()` to avoid exhaustion
5. **Enable debug mode in dev** - Catches issues early with zero production cost

## Error Handling

```typescript
try {
  const frame = log.writer!.allocate(bendec.getSize('Event'))
  // ... write event data
  log.writer!.commit()
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  if (message.includes('Shared memory exhausted')) {
    // Handle memory full - rotate files or wait for readers
  } else if (message.includes('ERR_SHM_FRAME_CORRUPT')) {
    // Debug mode caught corruption
  } else {
    // Other errors
  }
}
```

## Requirements

- Node.js 12.x or higher
- Linux or macOS (mmap support)
- `bendec` for serialization
- `rxjs` for streaming (optional)

## Building

```bash
# Install dependencies
npm install

# Build TypeScript and native addon
npm run build

# Run tests
npm test

# Run tests with debug mode
SHMIO_DEBUG=true npm test
```

## Limitations

1. **Platform-specific** - Linux/macOS only (requires POSIX mmap)
2. **Single writer** - Multiple writers will corrupt data
3. **No automatic cleanup** - File remains until explicitly deleted
4. **Fixed size** - Cannot grow after creation
5. **No built-in compression** - Store data as-is

## Troubleshooting

### "Shared memory exhausted"

Increase buffer size or number of buffers:

```typescript
const log = createSharedLog({
  path: '/dev/shm/myapp-events',
  capacityBytes: 32n * 1024n * 1024n,
  writable: true,
})
```

### Frame corruption in debug mode

Usually indicates:
- Multiple writers (violates single writer requirement)
- Manual buffer manipulation
- Process crashed mid-write

### File already exists

Delete stale files:

```bash
rm /dev/shm/myapp-events
```

Or handle in code:

```javascript
const fs = require('fs')
try {
  fs.unlinkSync('/dev/shm/myapp-events')
} catch (err) {
  // Ignore if doesn't exist
}
```

## Related Projects

- [bendec](https://github.com/gepheum/bendec) - Binary encoder/decoder for schemas
- [node-addon-api](https://github.com/nodejs/node-addon-api) - N-API wrapper used for mmap

## License

MIT

## Contributing

Contributions welcome! Please ensure:
- All tests pass: `npm test && SHMIO_DEBUG=true npm test`
- Code follows existing style
- Add tests for new features
- Update documentation

## Documentation

- [FIXES.md](FIXES.md) - Recent bug fixes and improvements
- [DEBUG.md](DEBUG.md) - Debug mode documentation
- [VALIDATION_SUMMARY.md](VALIDATION_SUMMARY.md) - Code validation results

## Author

Rafal Okninski <hpn777@gmail.com>

## Repository

https://github.com/hpn777/shmio
