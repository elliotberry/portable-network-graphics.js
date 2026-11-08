import fs from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import PNG from '../index.js';

const validBuffer = () => fs.readFileSync('test/images/rgb-8bit.png');

// Offset of the length field of the first chunk with the given type.
function findChunk(buffer, type) {
  let pos = 8;
  while (pos + 8 <= buffer.length) {
    const size = buffer.readUInt32BE(pos);
    const section = buffer.toString('ascii', pos + 4, pos + 8);
    if (section === type) return pos;
    pos += 12 + size;
  }
  throw new Error(`no ${type} chunk found`);
}

describe('malformed input', () => {
  it('empty buffer', () => {
    assert.throws(() => new PNG(Buffer.alloc(0)), /Invalid PNG signature/);
  });

  it('signature only', () => {
    const buffer = validBuffer().subarray(0, 8);
    assert.throws(() => new PNG(buffer), /Incomplete or corrupt PNG file/);
  });

  it('bad signature', () => {
    const buffer = validBuffer();
    buffer[0] = 0x00;
    assert.throws(() => new PNG(buffer), /Invalid PNG signature/);
  });

  it('truncated mid-IDAT', () => {
    const buffer = validBuffer();
    const idat = findChunk(buffer, 'IDAT');
    assert.throws(
      () => new PNG(buffer.subarray(0, idat + 12)),
      /Incomplete or corrupt PNG file/
    );
  });

  it('chunk length larger than file', () => {
    const buffer = validBuffer();
    buffer.writeUInt32BE(0xffffffff, findChunk(buffer, 'IDAT'));
    assert.throws(() => new PNG(buffer), /Incomplete or corrupt PNG file/);
  });

  it('zero dimensions', () => {
    const buffer = validBuffer();
    const ihdr = findChunk(buffer, 'IHDR');
    buffer.writeUInt32BE(0, ihdr + 8); // width field inside IHDR payload
    assert.throws(
      () => new PNG(buffer),
      /Invalid PNG dimensions: width and height must be nonzero/
    );
  });

  it('valid file still parses', () => {
    const png = new PNG(validBuffer());
    assert.ok(png.width > 0);
    assert.ok(png.height > 0);
  });
});
