"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const tape_1 = __importDefault(require("tape"));
const SharedMemory_1 = require("../../lib/SharedMemory");
(0, tape_1.default)('Shared memory file is written in /dev/shm', t => {
    const path = '/dev/shm/test';
    const size = 8;
    const num = 4;
    if (fs_1.default.existsSync(path)) {
        fs_1.default.unlinkSync(path);
    }
    const shm = new SharedMemory_1.SharedMemory({
        path,
        size,
        num,
        overlap: 0,
        writable: true,
    });
    const buffers = shm.getBuffers();
    const b0 = buffers[0];
    const b1 = buffers[1];
    const b3 = buffers[3];
    b0[0] = 65;
    b0[1] = 66;
    b0[2] = 67;
    b1[3] = 68;
    b1[4] = 69;
    b3[5] = 70;
    b3[size - 1] = 71;
    const fileContents = fs_1.default.readFileSync(path);
    const allBuffers = Buffer.concat(buffers);
    t.deepEqual(allBuffers, fileContents);
    t.equal(fileContents.length, size * num);
    t.equal(buffers.length, num);
    fs_1.default.unlinkSync(path);
    t.end();
});
(0, tape_1.default)('Memory mapped file is written in /tmp', t => {
    const path = `/tmp/mapped_file_test`;
    const size = 8;
    const num = 4;
    if (fs_1.default.existsSync(path)) {
        fs_1.default.unlinkSync(path);
    }
    const shm = new SharedMemory_1.SharedMemory({
        path,
        size,
        num,
        overlap: 0,
        writable: true,
    });
    const buffers = shm.getBuffers();
    buffers[0][0] = 65;
    buffers[1][0] = 66;
    buffers[2][0] = 67;
    buffers[3][0] = 68;
    buffers[3][size - 1] = 69;
    const fileContents = fs_1.default.readFileSync(path);
    const allBuffers = Buffer.concat(buffers);
    t.deepEqual(allBuffers, fileContents);
    t.equal(fileContents.length, size * num);
    t.equal(buffers.length, num);
    fs_1.default.unlinkSync(path);
    t.end();
});
(0, tape_1.default)('non existent shm is opened for reading only', t => {
    const path = `/dev/shm/test_readonly`;
    const size = 8;
    const num = 4;
    if (fs_1.default.existsSync(path)) {
        fs_1.default.unlinkSync(path);
    }
    t.throws(() => {
        new SharedMemory_1.SharedMemory({
            path,
            size,
            num,
            overlap: 0,
            writable: false,
        });
    });
    t.end();
});
//# sourceMappingURL=index.js.map