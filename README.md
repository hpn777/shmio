# shmio

High-performance shared memory library for Node.js with append-only log semantics, designed for event sourcing and inter-process communication.

## Features

- Memory-mapped files with automatic buffer management
- Append-only log with atomic commits
- Symmetric frame headers for bidirectional iteration
- Zero-copy buffer slicing
- Multi-process reader support (single writer)
- Debug mode for development with zero production overhead
- TypeScript support with full type definitions

## Installation

```bash
npm install shmio
```

## Quick Start

### Writer Process

```javascript
const { SharedMemory, Pool } = require('shmio')
const { Bendec } = require('bendec')

// Define your message schema
const types = [{
  name: 'LogEvent',
  fields: [
    { name: 'timestamp', type: 'u64' },
    { name: 'level', type: 'u8' },
    { name: 'message', type: 'string' }
  ]
}]

const bendec = new Bendec({ types })

// Create shared memory
const shm = new SharedMemory({
  path: '/dev/shm/myapp-events',  // Use /dev/shm for true shared memory
  size: 1024 * 1024,              // 1MB per buffer
  num: 10,                         // 10 buffers = 10MB total
  overlap: 4096,                   // 4KB overlap between buffers
  writable: true
})

// Create pool for writing
const pool = new Pool(bendec, shm)

// Write events
const event = pool.wrap('LogEvent')
event.timestamp = BigInt(Date.now())
event.level = 1
event.message = 'Application started'

// Commit to make visible to readers
pool.commit()
```

### Reader Process

```javascript
const { SharedMemory, SharedMemoryConsumer } = require('shmio')

// Open shared memory (read-only)
const shm = new SharedMemory({
  path: '/dev/shm/myapp-events',
  size: 1024 * 1024,
  num: 10,
  overlap: 4096,
  writable: false  // Read-only
})

// Create consumer
const consumer = new SharedMemoryConsumer(shm)

// Stream all events (past and future)
consumer.getAll(10).subscribe(iterator => {
  for (const buffer of iterator) {
    const event = bendec.decodeAs(buffer, 'LogEvent')
    console.log(event)
  }
})
```

## API

### SharedMemory

Creates a memory-mapped file or shared memory region.

```javascript
new SharedMemory({
  path: string,      // File path (/dev/shm/name for shared memory)
  size: number,      // Size of each buffer in bytes
  num: number,       // Number of buffers
  overlap: number,   // Overlap between buffers in bytes
  writable: boolean  // Open for writing (creates if needed)
})
```

**Methods:**
- `getBuffers()` - Returns array of Buffer objects
- `getConfig()` - Returns configuration object

### Pool

Manages buffer allocation with automatic overflow handling.

```javascript
new Pool(bendec, sharedMemory)
```

**Methods:**
- `slice(typeName)` - Allocate buffer for a specific type
- `sliceSize(bytes)` - Allocate buffer of specific size
- `wrap(typeName)` - Allocate and wrap in Bendec wrapper
- `commit()` - Atomically commit all writes (makes them visible to readers)
- `getSize()` - Returns `[committedSize, uncommittedSize]`
- `getStatus()` - Returns `[bufferIndex, byteOffset]`
- `setActive(boolean)` - Enable/disable buffer pooling

### SharedMemoryConsumer

Reads events from shared memory with optional streaming.

```javascript
new SharedMemoryConsumer(sharedMemory)
```

**Methods:**
- `getData(fromIndex?)` - Returns iterator for range
- `getAll(pollInterval?)` - Returns Observable that emits iterators (requires RxJS)

### SharedMemoryIterator

Iterator for reading events sequentially.

```javascript
const iterator = new SharedMemoryIterator(sharedMemory, fromIndex, toIndex)

for (const buffer of iterator) {
  // Process buffer
}
```

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

- ONE writer process can call `commit()` - Multiple writers will corrupt data
- MULTIPLE reader processes can read concurrently - Safe with atomic size updates
- NO explicit locking - Relies on atomic 64-bit writes on x86/x64

Writers must:
1. Write all event data
2. Call `commit()` to make events visible atomically

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

```javascript
// Writer: Event producer
const pool = new Pool(bendec, shm)

function recordEvent(type, data) {
  const event = pool.wrap('Event')
  event.type = type
  event.timestamp = BigInt(Date.now())
  event.data = data
  pool.commit()  // Atomic commit
}

// Reader: Event consumer
consumer.getAll(10).subscribe(iterator => {
  for (const buffer of iterator) {
    const event = bendec.decodeAs(buffer, 'Event')
    processEvent(event)
  }
})
```

### System Monitoring

Real-time log streaming between processes:

```javascript
// Logger process
function log(level, message) {
  const entry = pool.wrap('LogEntry')
  entry.timestamp = BigInt(Date.now())
  entry.level = level
  entry.message = message
  pool.commit()
}

// Monitor process
consumer.getAll(100).subscribe(iterator => {
  for (const buffer of iterator) {
    const entry = bendec.decodeAs(buffer, 'LogEntry')
    console.log(`[${entry.level}] ${entry.message}`)
  }
})
```

### Inter-Process Communication

High-speed message passing:

```javascript
// Producer
for (let i = 0; i < 1000; i++) {
  const msg = pool.wrap('Message')
  msg.id = i
  msg.payload = generateData()
}
pool.commit()  // Batch commit for performance

// Consumer
const data = consumer.getData()
for (const buffer of data) {
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

```javascript
try {
  const event = pool.wrap('Event')
  // ... write event data
  pool.commit()
} catch (err) {
  if (err.message.includes('Shared memory exhausted')) {
    // Handle memory full - rotate files or wait for readers
  } else if (err.message.includes('[DEBUG]')) {
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

```javascript
const shm = new SharedMemory({
  size: 2 * 1024 * 1024,  // 2MB instead of 1MB
  num: 20                  // 20 buffers instead of 10
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
