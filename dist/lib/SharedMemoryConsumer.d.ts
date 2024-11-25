/// <reference types="node" />
import { SharedMemory } from './SharedMemory';
import { SharedMemoryIterator } from './SharedMemoryIterator';
import { Observable } from 'rxjs';
declare class SharedMemoryConsumer {
    private sharedMemory;
    private buffers;
    private dataOffset;
    private memHeaderWrapper;
    constructor(sharedMemory: SharedMemory);
    getAll(pollInterval?: number): Observable<Iterable<Buffer>>;
    getData(fromIndex?: number): SharedMemoryIterator;
    private getSize;
}
export { SharedMemoryConsumer };
