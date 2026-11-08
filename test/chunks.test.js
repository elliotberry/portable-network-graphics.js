import fs from 'node:fs';
import zlib from 'node:zlib';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import PNG from '../index.js';

// Chunk-level coverage the image fixtures can't provide: every checked-in
// PNG has a single IDAT chunk and no tEXt chunk, so these tests synthesize
// variants from a real fixture instead of adding binaries.

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

// The decoder skips CRCs, but real ones keep the fixtures valid PNGs.
function chunk(type, payload) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(payload.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), payload])), 0);
  return Buffer.concat([head, payload, crc]);
}

function withTextChunk(payload) {
  const buffer = validBuffer();
  const idat = findChunk(buffer, 'IDAT');
  return Buffer.concat([
    buffer.subarray(0, idat),
    chunk('tEXt', payload),
    buffer.subarray(idat)
  ]);
}

// Replaces the fixture's single IDAT chunk with one chunk per span between
// consecutive split points (so [n] makes two chunks and [n, n] makes three,
// the middle one empty).
function splitIdat(splitPoints) {
  const buffer = validBuffer();
  const idat = findChunk(buffer, 'IDAT');
  const size = buffer.readUInt32BE(idat);
  const payload = buffer.subarray(idat + 8, idat + 8 + size);
  const bounds = [0, ...splitPoints, size];
  const chunks = [];
  for (let i = 1; i < bounds.length; i++) {
    chunks.push(chunk('IDAT', payload.subarray(bounds[i - 1], bounds[i])));
  }
  return Buffer.concat([
    buffer.subarray(0, idat),
    ...chunks,
    buffer.subarray(idat + 12 + size)
  ]);
}

const idatSize = (() => {
  const buffer = validBuffer();
  return buffer.readUInt32BE(findChunk(buffer, 'IDAT'));
})();

describe('multiple IDAT chunks', () => {
  it('split streams concatenate to the single-chunk result', () => {
    const original = new PNG(validBuffer());
    const split = new PNG(splitIdat([idatSize >> 1]));
    assert.deepEqual(Buffer.from(split.imgData), Buffer.from(original.imgData));
    assert.deepEqual(
      Buffer.from(split.decodePixelsSync()),
      Buffer.from(original.decodePixelsSync())
    );
  });

  it('zero-length IDAT chunks are tolerated', () => {
    const original = new PNG(validBuffer());
    const split = new PNG(splitIdat([1, 1, idatSize >> 1]));
    assert.deepEqual(Buffer.from(split.imgData), Buffer.from(original.imgData));
    assert.deepEqual(
      Buffer.from(split.decodePixelsSync()),
      Buffer.from(original.decodePixelsSync())
    );
  });
});

describe('tEXt chunks', () => {
  it('parses a key/value pair', () => {
    const png = new PNG(withTextChunk(Buffer.from('Title\0Hello, png.js')));
    assert.deepEqual(png.text, { Title: 'Hello, png.js' });
    // The inserted chunk must not disturb the surrounding parse.
    assert.ok(png.width > 0);
    assert.deepEqual(
      Buffer.from(png.decodePixelsSync()),
      Buffer.from(new PNG(validBuffer()).decodePixelsSync())
    );
  });

  it('preserves the historical no-separator behavior', () => {
    // Without a NUL separator, indexOf returns -1 and the slices keep
    // behaving as they always have: the key drops the payload's last
    // byte and the value repeats the whole payload.
    const png = new PNG(withTextChunk(Buffer.from('NoSeparator')));
    assert.deepEqual(png.text, { NoSeparato: 'NoSeparator' });
  });

  it('decodes values longer than 0x8000 across chunks', () => {
    // Position-dependent bytes so an offset error at a 0x8000 boundary
    // changes the result.
    const length = 0x10005;
    const value = Buffer.alloc(length);
    let expected = '';
    for (let i = 0; i < length; i++) {
      value[i] = 32 + (i % 95);
      expected += String.fromCharCode(32 + (i % 95));
    }
    const png = new PNG(
      withTextChunk(Buffer.concat([Buffer.from('Comment\0'), value]))
    );
    assert.equal(png.text.Comment.length, length);
    assert.equal(png.text.Comment, expected);
  });
});

describe('decode errors', () => {
  const makePng = compressed => {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(1, 0);
    header.writeUInt32BE(1, 4);
    header[8] = 8;
    header[9] = 2;
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', compressed),
      chunk('IEND', Buffer.alloc(0))
    ]);
  };

  it('rejects (not throws uncaught) on corrupt zlib data', async () => {
    const png = new PNG(makePng(Buffer.from([0, 0, 0, 0])));
    await assert.rejects(png.decodePixels());
  });

  it('rejects on an invalid filter type', async () => {
    const png = new PNG(makePng(zlib.deflateSync(Buffer.from([5, 12, 34, 56]))));
    await assert.rejects(png.decodePixels(), /Invalid filter algorithm: 5/);
  });

  it('decodePixelsSync throws on an invalid filter type', () => {
    const png = new PNG(makePng(zlib.deflateSync(Buffer.from([5, 12, 34, 56]))));
    assert.throws(() => png.decodePixelsSync(), /Invalid filter algorithm: 5/);
  });
});
