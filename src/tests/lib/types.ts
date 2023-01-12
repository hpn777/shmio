import { Bendec } from 'bendec'

/**
 * Simple sample types for tests involving Bendec
 */
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
]

const getVariant = {
  encode: (message: any) => 'Sample',
  decode: (buffer: Buffer) => 'Sample',
}

const getBendec = () => {
  return new Bendec<any>({ types, getVariant })
}

export { types, getVariant, getBendec }
