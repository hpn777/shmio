import { Readers, Writers, Bendec } from 'bendec'

const types = [
  {
    // "kind": "Primitive",
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
]



const getVariant = {
  encode: (message: any) => 'MemHeader',
  decode: (buffer: Buffer) => 'MemHeader',
}

const readers: Readers = {
  u64: (index, _length): [string, number] => [`buffer.readBigUInt64LE(${index})`, index + 8]
}
const writers: Writers = {
  u64: (index, length, path = 'v'): [string, number] => [`buffer.writeBigUInt64LE(${path}, ${index})`, index + 8]
}

const getBendec = () => {
  return new Bendec<any>({ types, getVariant, readers, writers})
}

interface MemHeader {
  header_size: bigint
  data_offset: bigint
  size: bigint
}

export { getBendec }
