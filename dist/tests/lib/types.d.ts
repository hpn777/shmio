/// <reference types="node" />
import { Bendec } from 'bendec';
declare const types: ({
    name: string;
    size: number;
    fields?: undefined;
} | {
    name: string;
    fields: {
        name: string;
        type: string;
        length: number;
    }[];
    size?: undefined;
})[];
declare const getVariant: {
    encode: (message: any) => string;
    decode: (buffer: Buffer) => string;
};
declare const getBendec: () => Bendec<any>;
export { types, getVariant, getBendec };
