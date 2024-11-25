"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const SharedMemory_1 = require("../../lib/SharedMemory");
const path = `/dev/shm/test_readonly`;
const size = 8;
const num = 4;
const shmRead = new SharedMemory_1.SharedMemory({
    path,
    size,
    num,
    overlap: 0,
    writable: false,
});
const buffersRead = shmRead.getBuffers();
buffersRead[0][0] = 65;
//# sourceMappingURL=segfault.js.map