/// <reference types="node" />
import { SharedMemory } from './SharedMemory';
declare class SharedMemoryIterator implements Iterator<Buffer> {
    private sharedMemory;
    private buffers;
    private index;
    private bufferIndex;
    private currentBuffer;
    private buffersTotal;
    private bufferLength;
    private totalSize;
    constructor(sharedMemory: SharedMemory, fromIndex: number, toIndex: number);
    [Symbol.iterator](): this;
    next(): {
        value: any;
        done: boolean;
    };
}
declare const shmIter: (sharedMemory: SharedMemory, fromIndex: number, toIndex: number) => SharedMemoryIterator;
export { SharedMemoryIterator, shmIter };
