/// <reference types="node" />
declare enum Protection {
    PROT_NONE = 0,
    PROT_READ = 1,
    PROT_WRITE = 2,
    PROT_EXEC = 4
}
declare enum Flags {
    MAP_SHARED = 1,
    MAP_PRIVATE = 2
}
interface MMap {
    setup(size: number, num: number, overlap: number, protection: Protection, flags: Flags, fd: number): Buffer[];
}
declare const mmap: MMap;
declare class SharedMemory {
    private buffers;
    private config;
    constructor(config: SharedMemoryConfig);
    getBuffers(): Buffer[];
    getConfig(): SharedMemoryConfig;
    private setup;
}
interface SharedMemoryConfig {
    path: string;
    size: number;
    num: number;
    overlap: number;
    writable: boolean;
}
export { SharedMemory, SharedMemoryConfig, MMap, mmap };
