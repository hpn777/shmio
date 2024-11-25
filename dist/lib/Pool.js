"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Pool = void 0;
const assert_1 = __importDefault(require("assert"));
const memHeader_1 = require("./memHeader");
const MESSAGE_HEADER_SIZE = 2;
const mhBendec = (0, memHeader_1.getBendec)();
const HEADER_SIZE = mhBendec.getSize('MemHeader');
class Pool {
    static MESSAGE_HEADER_SIZE = MESSAGE_HEADER_SIZE;
    static HEADER_SIZE = HEADER_SIZE;
    bendec;
    memHeaderWrapper;
    index = HEADER_SIZE;
    bufferIndex = 0;
    currentBuffer;
    buffers;
    bufferLength;
    overlap;
    uncommittedSize = 0;
    currentSize = HEADER_SIZE;
    active = true;
    constructor(bendec, sharedMemory) {
        this.bendec = bendec;
        this.buffers = sharedMemory.getBuffers();
        this.memHeaderWrapper = mhBendec.getWrapper('MemHeader');
        this.memHeaderWrapper.setBuffer(this.buffers[0]);
        this.overlap = sharedMemory.getConfig().overlap;
        this.bufferLength = this.buffers[0].length - this.overlap;
        this.currentBuffer = this.buffers[0];
        this.currentSize = Number(this.memHeaderWrapper.size);
        if (this.currentSize === 0) {
            this.memHeaderWrapper.headerSize = BigInt(HEADER_SIZE);
            this.memHeaderWrapper.size = BigInt(HEADER_SIZE);
            this.memHeaderWrapper.dataOffset = BigInt(HEADER_SIZE);
            this.currentSize = HEADER_SIZE;
        }
        this.index = this.currentSize % this.bufferLength;
        this.bufferIndex = Math.floor(this.currentSize / this.bufferLength);
        this.currentBuffer = this.buffers[this.bufferIndex];
        (0, assert_1.default)(this.buffers[0].length >= 32, 'Buffers must be at least 32 bytes');
        (0, assert_1.default)(this.buffers.reduce((r, buffer) => r && buffer.length === this.buffers[0].length, true), 'Buffers must be the same size');
    }
    commit() {
        this.currentSize += this.uncommittedSize;
        this.uncommittedSize = 0;
        this.memHeaderWrapper.size = BigInt(this.currentSize);
    }
    setActive(active) {
        this.active = active;
    }
    sliceSize(size) {
        if (!this.active) {
            return Buffer.alloc(size);
        }
        const buffer = this.currentBuffer.slice(this.index + MESSAGE_HEADER_SIZE, this.index + MESSAGE_HEADER_SIZE + size);
        const sizeWithFrame = size + (2 * MESSAGE_HEADER_SIZE);
        this.currentBuffer.writeUInt16LE(sizeWithFrame, this.index);
        this.currentBuffer.writeUInt16LE(sizeWithFrame, this.index + MESSAGE_HEADER_SIZE + size);
        this.index += sizeWithFrame;
        this.uncommittedSize += sizeWithFrame;
        if (this.index >= this.bufferLength) {
            this.index -= this.bufferLength;
            this.bufferIndex++;
            this.currentBuffer = this.buffers[this.bufferIndex];
        }
        return buffer;
    }
    slice(name) {
        return this.sliceSize(this.bendec.getSize(name));
    }
    wrap(name) {
        return this.bendec.wrap(name, this.slice(name));
    }
    getStatus() {
        return [this.bufferIndex, this.index];
    }
    getSize() {
        return [this.currentSize, this.uncommittedSize];
    }
    isUsed() {
        return this.currentSize > Number(this.memHeaderWrapper.dataOffset);
    }
}
exports.Pool = Pool;
//# sourceMappingURL=Pool.js.map