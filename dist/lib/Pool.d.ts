/// <reference types="node" />
import { Bendec, BufferWrapper } from 'bendec';
import { SharedMemory } from './SharedMemory';
declare type PoolType = any;
declare class Pool<T = PoolType> {
    static readonly MESSAGE_HEADER_SIZE: number;
    static readonly HEADER_SIZE: number;
    bendec: Bendec<T>;
    private memHeaderWrapper;
    private index;
    private bufferIndex;
    private currentBuffer;
    private buffers;
    private bufferLength;
    private overlap;
    private uncommittedSize;
    private currentSize;
    private active;
    constructor(bendec: Bendec<T>, sharedMemory: SharedMemory);
    commit(): void;
    setActive(active: boolean): void;
    sliceSize(size: number): Buffer;
    slice(name: string): Buffer;
    wrap(name: string): BufferWrapper<T>;
    getStatus(): [number, number];
    getSize(): [number, number];
    isUsed(): boolean;
}
export { Pool };
