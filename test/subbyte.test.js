import fs from 'node:fs';
import zlib from 'node:zlib';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import PNG from '../index.js';

// Sub-byte bit depths (1/2/4-bit) pack multiple pixels per byte, so
// scanlines are byte-padded and filtering treats them as one byte per
// pixel (PNG spec 4.5.2 / 9.2). These tests pin the spec-correct
// behavior: byte-aligned output rows, integer neighbor offsets, and no
// crash on scanlines that are not a whole multiple of pixels.

function makePng({ width, height, bitDepth, rows }) {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
  ]);

  // CRC values are zeros: the decoder validates lengths, not checksums.
  const chunk = (type, payload) => {
    const out = Buffer.alloc(12 + payload.length);
    out.writeUInt32BE(payload.length, 0);
    out.write(type, 4, 'ascii');
    payload.copy(out, 8);
    return out;
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = 0; // grayscale

  // Each row: [filterType, ...packedBytes]
  const raw = Buffer.concat(rows.map(row => Buffer.from(row)));

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const decode = buffer => new PNG(buffer).decodePixels();

describe('sub-byte bit depths', () => {
  it('1-bit rows pad to whole bytes (7px wide, filter None)', async () => {
    // One packed byte per row; bit 0 of the byte is padding.
    const rows = [
      [0, 0b10101010],
      [0, 0b01010100],
      [0, 0b11110000]
    ];
    const pixels = await decode(
      makePng({ width: 7, height: 3, bitDepth: 1, rows })
    );
    assert.deepEqual(Array.from(pixels), [0b10101010, 0b01010100, 0b11110000]);
  });

  it('non-aligned width does not crash on filter None', async () => {
    // 1x2 4-bit: half a byte of pixels per row, one padded byte stored.
    const rows = [
      [0, 0x70],
      [0, 0x30]
    ];
    const pixels = await decode(
      makePng({ width: 1, height: 2, bitDepth: 4, rows })
    );
    assert.deepEqual(Array.from(pixels), [0x70, 0x30]);
  });

  it('Sub filter uses a one-byte pixel offset', async () => {
    // 6px 4-bit = 3 packed bytes/row. Raw row [0x12, 0x34, 0x56]
    // Sub-filtered with bpp=1: [0x12, 0x34-0x12, 0x56-0x34].
    const rows = [[1, 0x12, 0x22, 0x22]];
    const pixels = await decode(
      makePng({ width: 6, height: 1, bitDepth: 4, rows })
    );
    assert.deepEqual(Array.from(pixels), [0x12, 0x34, 0x56]);
  });

  it('Up filter reads the previous padded row', async () => {
    // 3px 4-bit = ceil(1.5) = 2 bytes/row.
    const rows = [
      [0, 0x10, 0x20],
      [2, 0x05, 0x05] // row1 = row0 + delta
    ];
    const pixels = await decode(
      makePng({ width: 3, height: 2, bitDepth: 4, rows })
    );
    assert.deepEqual(Array.from(pixels), [0x10, 0x20, 0x15, 0x25]);
  });

  it('Average and Paeth filters decode without fractional offsets', async () => {
    // 3px 4-bit, rows: None, Average, Paeth.
    const rows = [
      [0, 0x40, 0x60],
      [3, 0x22, 0x12],
      [4, 0x02, 0x03]
    ];
    const pixels = await decode(
      makePng({ width: 3, height: 3, bitDepth: 4, rows })
    );
    assert.deepEqual(
      Array.from(pixels),
      [0x40, 0x60, 0x42, 0x63, 0x44, 0x66]
    );
  });

  it('decodes the 1-bit 7x7 and 4-bit 1x2 fixtures', async () => {
    const oneBit = new PNG(
      fs.readFileSync('test/images/grayscale-1bit-7x7.png')
    );
    assert.equal(oneBit.bits, 1);
    assert.equal((await oneBit.decodePixels()).length, 7); // 1 byte per row

    const fourBit = new PNG(
      fs.readFileSync('test/images/grayscale-4bit-1x2.png')
    );
    assert.equal(fourBit.bits, 4);
    assert.equal((await fourBit.decodePixels()).length, 2);

    // RGBA expansion shouldn't throw on these either.
    await oneBit.decode();
    await fourBit.decode();
  });
});
