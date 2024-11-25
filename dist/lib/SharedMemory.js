"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mmap = exports.SharedMemory = void 0;
const fs_1 = require("fs");
const { O_RDONLY, O_RDWR, O_CREAT, O_EXCL, O_NOFOLLOW } = fs_1.constants;
var Protection;
(function (Protection) {
    Protection[Protection["PROT_NONE"] = 0] = "PROT_NONE";
    Protection[Protection["PROT_READ"] = 1] = "PROT_READ";
    Protection[Protection["PROT_WRITE"] = 2] = "PROT_WRITE";
    Protection[Protection["PROT_EXEC"] = 4] = "PROT_EXEC";
})(Protection || (Protection = {}));
var Flags;
(function (Flags) {
    Flags[Flags["MAP_SHARED"] = 1] = "MAP_SHARED";
    Flags[Flags["MAP_PRIVATE"] = 2] = "MAP_PRIVATE";
})(Flags || (Flags = {}));
const mmap = require('../../build/Release/mmap');
exports.mmap = mmap;
class SharedMemory {
    buffers;
    config;
    constructor(config) {
        this.buffers = this.setup(config);
        this.config = config;
    }
    getBuffers() {
        return this.buffers;
    }
    getConfig() {
        return this.config;
    }
    setup(config) {
        const permissions = 0o664;
        const flags = config.writable
            ? O_RDWR
            : O_RDONLY;
        let fd;
        try {
            fd = (0, fs_1.openSync)(config.path, flags, permissions);
        }
        catch (e) {
            if (!config.writable) {
                throw new Error(`File does not exist and writable = false, path: ${config.path}`);
            }
            fd = (0, fs_1.openSync)(config.path, O_RDWR | O_CREAT, permissions);
            (0, fs_1.ftruncateSync)(fd, config.size * config.num);
        }
        const protection = config.writable
            ? Protection.PROT_READ | Protection.PROT_WRITE
            : Protection.PROT_READ;
        return mmap.setup(config.size, config.num, config.overlap, protection, Flags.MAP_SHARED, fd);
    }
}
exports.SharedMemory = SharedMemory;
//# sourceMappingURL=SharedMemory.js.map