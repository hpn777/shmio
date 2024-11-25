"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBendec = exports.getVariant = exports.types = void 0;
const bendec_1 = require("bendec");
const types = [
    {
        name: 'u8',
        size: 1,
    },
    {
        name: 'Sample',
        fields: [
            {
                name: 'foo',
                type: 'u8',
                length: 13,
            },
        ],
    },
];
exports.types = types;
const getVariant = {
    encode: (message) => 'Sample',
    decode: (buffer) => 'Sample',
};
exports.getVariant = getVariant;
const getBendec = () => {
    return new bendec_1.Bendec({ types, getVariant });
};
exports.getBendec = getBendec;
//# sourceMappingURL=types.js.map