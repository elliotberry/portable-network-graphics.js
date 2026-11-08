import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import PNG from './index.js';

describe('PNG', () => {
  it('constructor should throw error if data is not a Buffer', () => {
    assert.throws(() => new PNG('not a buffer'), /PNG: expected Buffer/);
  });

  it('constructor should parse a real file', () => {
    const png = new PNG(readFileSync('test/images/rgb-8bit.png'));

    assert.ok(png.width > 0);
    assert.ok(png.height > 0);
    assert.deepEqual(png.palette, []);
    assert.deepEqual(png.transparency, {});
    assert.deepEqual(png.text, {});
    assert.ok(png.imgData instanceof Uint8Array);
    // The source buffer is released after parsing.
    assert.equal(png.data, null);
  });

  it('decode() resolves to RGBA pixels', async () => {
    const png = new PNG(readFileSync('test/images/rgb-8bit.png'));
    const pixels = await png.decode();
    assert.equal(pixels.length, png.width * png.height * 4);
  });

  it('decodePixelsSync() matches decodePixels()', async () => {
    const buffer = readFileSync('test/images/rgb-8bit.png');
    const sync = new PNG(buffer).decodePixelsSync();
    const async = await new PNG(buffer).decodePixels();
    assert.deepEqual(Buffer.from(sync), Buffer.from(async));
  });

  it('PNG.decode(path) resolves to RGBA pixels', async () => {
    const pixels = await PNG.decode('test/images/rgb-8bit.png');
    assert.ok(pixels instanceof Uint8Array);
  });

  it('PNG.decode(path) rejects for a missing file', async () => {
    await assert.rejects(PNG.decode('test/images/nope.png'), {
      code: 'ENOENT'
    });
  });

  it('decodes every fixture in sync and async form identically', async () => {
    const { readdirSync } = await import('node:fs');
    for (const name of readdirSync('test/images')) {
      if (!name.endsWith('.png')) continue;
      const buffer = readFileSync(`test/images/${name}`);
      const sync = new PNG(buffer).decodePixelsSync();
      const async = await new PNG(buffer).decodePixels();
      assert.deepEqual(Buffer.from(sync), Buffer.from(async), name);
    }
  });
});
