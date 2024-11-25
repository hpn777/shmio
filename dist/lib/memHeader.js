"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBendec = void 0;
const bendec_1 = require("bendec");
const types = [
    {
        "name": "u64",
        "size": 8,
    },
    {
        "name": "MemHeader",
        "fields": [{
                "name": "headerSize",
                "type": "u64",
                "description": "header size for external usage (metadata)"
            }, {
                "name": "dataOffset",
                "type": "u64",
                "description": "data log start point (metadata)"
            }, {
                "name": "size",
                "type": "u64",
                "description": "Size of the file and the current cursor index"
            }]
    }
];
const getVariant = {
    encode: (message) => 'MemHeader',
    decode: (buffer) => 'MemHeader',
};
const readers = {
    u64: (index, _length) => [`buffer.readBigUInt64LE(${index})`, index + 8]
};
const writers = {
    u64: (index, length, path = 'v') => [`buffer.writeBigUInt64LE(${path}, ${index})`, index + 8]
};
const getBendec = () => {
    return new bendec_1.Bendec({ types, getVariant, readers, writers });
};
exports.getBendec = getBendec;
//# sourceMappingURL=memHeader.js.map