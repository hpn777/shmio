"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const tape_1 = __importDefault(require("tape"));
const lodash_1 = require("lodash");
const fs_1 = require("fs");
const lib_1 = require("../../lib");
const types_1 = require("./types");
(0, tape_1.default)('shm iterator', async (t2) => {
    const bendec = (0, types_1.getBendec)();
    const encoder = new TextEncoder();
    const encode = encoder.encode.bind(encoder);
    const MSG_SIZE = bendec.getSize('Sample');
    const MSG_SIZE_WITH_HEADER = MSG_SIZE + 2 * lib_1.Pool.MESSAGE_HEADER_SIZE;
    const OVERLAP = MSG_SIZE_WITH_HEADER;
    const config = {
        path: '/dev/shm/test',
        size: 64,
        num: 4,
        overlap: OVERLAP,
        writable: true,
    };
    await fs_1.promises.unlink(config.path).catch(() => undefined);
    const sharedMemory = new lib_1.SharedMemory(config);
    const buffers = sharedMemory.getBuffers();
    const pool = new lib_1.Pool(bendec, sharedMemory);
    const slices = (0, lodash_1.range)(1, 11).map(i => {
        const slice = pool.slice('Sample');
        bendec.encodeAs({
            foo: encode(`lorem ipsum ${i}`)
        }, 'Sample', slice);
        return slice;
    });
    pool.commit();
    (0, tape_1.default)('all combinations', t => {
        slices.forEach((slice, from) => {
            (0, lodash_1.range)(1, slices.length - from).forEach(l => {
                const to = l + from;
                const subSlice = slices.slice(from, to);
                const iter = (0, lib_1.shmIter)(sharedMemory, lib_1.Pool.HEADER_SIZE + from * MSG_SIZE_WITH_HEADER, pool.getSize()[0]);
                const result = [...iter];
                subSlice.forEach((buffer, i) => {
                    let decodedBuffer = bendec.decodeAs(result[i], 'Sample');
                    decodedBuffer.foo = String.fromCharCode(...decodedBuffer.foo);
                    t.deepEquals(result[i], buffer);
                });
            });
        });
        t.end();
    });
    t2.end();
});
//# sourceMappingURL=shm.js.map