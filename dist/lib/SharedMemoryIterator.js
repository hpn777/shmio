"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shmIter = exports.SharedMemoryIterator = void 0;
const MESSAGE_HEADER_SIZE = 2;
class SharedMemoryIterator {
    sharedMemory;
    buffers;
    index;
    bufferIndex = 0;
    currentBuffer;
    buffersTotal = 0;
    bufferLength;
    totalSize;
    constructor(sharedMemory, fromIndex, toIndex) {
        this.sharedMemory = sharedMemory;
        const overlap = sharedMemory.getConfig().overlap;
        this.buffers = sharedMemory.getBuffers();
        this.bufferLength = this.buffers[0].length - overlap;
        this.totalSize = toIndex;
        this.bufferIndex = Math.floor(fromIndex / this.bufferLength);
        this.buffersTotal = this.bufferLength * this.bufferIndex;
        this.currentBuffer = this.buffers[this.bufferIndex];
        this.index = fromIndex % this.bufferLength;
        if (this.totalSize <= fromIndex) {
            this.next = () => {
                return { value: undefined, done: true };
            };
        }
    }
    [Symbol.iterator]() {
        return this;
    }
    next() {
        if (this.buffersTotal + this.index >= this.totalSize) {
            return {
                value: undefined,
                done: true,
            };
        }
        const size = this.currentBuffer.readUInt16LE(this.index);
        const item = {
            value: this.currentBuffer.slice((this.index + MESSAGE_HEADER_SIZE), this.index + size - MESSAGE_HEADER_SIZE),
            done: false,
        };
        this.index += size;
        if (this.index >= this.bufferLength) {
            this.index -= this.bufferLength;
            this.bufferIndex++;
            this.buffersTotal += this.bufferLength;
            this.currentBuffer = this.buffers[this.bufferIndex];
        }
        return item;
    }
}
exports.SharedMemoryIterator = SharedMemoryIterator;
const shmIter = (sharedMemory, fromIndex, toIndex) => {
    return new SharedMemoryIterator(sharedMemory, fromIndex, toIndex);
};
exports.shmIter = shmIter;
//# sourceMappingURL=SharedMemoryIterator.js.map