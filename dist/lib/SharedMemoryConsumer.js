"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SharedMemoryConsumer = void 0;
const SharedMemoryIterator_1 = require("./SharedMemoryIterator");
const rxjs_1 = require("rxjs");
const operators_1 = require("rxjs/operators");
const memHeader_1 = require("./memHeader");
class SharedMemoryConsumer {
    sharedMemory;
    buffers;
    dataOffset;
    memHeaderWrapper;
    constructor(sharedMemory) {
        this.sharedMemory = sharedMemory;
        this.buffers = sharedMemory.getBuffers();
        const mhBendec = (0, memHeader_1.getBendec)();
        this.memHeaderWrapper = mhBendec.getWrapper('MemHeader');
        this.memHeaderWrapper.setBuffer(this.buffers[0]);
        this.dataOffset = Number(this.memHeaderWrapper.dataOffset);
    }
    getAll(pollInterval = 10) {
        let currentIndex = this.dataOffset;
        const endIndex = Math.max(this.getSize(), this.dataOffset);
        const shmIter = new SharedMemoryIterator_1.SharedMemoryIterator(this.sharedMemory, currentIndex, endIndex);
        const currentData$ = (0, rxjs_1.of)(shmIter);
        currentIndex = endIndex;
        return (0, rxjs_1.concat)(currentData$, (0, rxjs_1.interval)(pollInterval).pipe((0, operators_1.filter)(() => this.getSize() > currentIndex), (0, operators_1.map)(() => {
            const end = this.getSize();
            const iterator = new SharedMemoryIterator_1.SharedMemoryIterator(this.sharedMemory, currentIndex, end);
            currentIndex = end;
            return iterator;
        }), (0, operators_1.share)()));
    }
    getData(fromIndex = this.dataOffset) {
        const buffers = this.sharedMemory.getBuffers();
        return new SharedMemoryIterator_1.SharedMemoryIterator(this.sharedMemory, fromIndex, this.getSize());
    }
    getSize() {
        return Number(this.memHeaderWrapper.size);
    }
}
exports.SharedMemoryConsumer = SharedMemoryConsumer;
//# sourceMappingURL=SharedMemoryConsumer.js.map