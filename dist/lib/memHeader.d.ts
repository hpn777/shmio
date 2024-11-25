/// <reference types="node" />
import { Bendec } from 'bendec';
declare const getBendec: () => Bendec<any>;
interface MemHeader {
    headerSize: bigint;
    dataOffset: bigint;
    size: bigint;
    getBuffer: () => Buffer;
    setBuffer: (data: Buffer) => boolean;
}
export { MemHeader, getBendec };
