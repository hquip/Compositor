import test from 'node:test';
import assert from 'node:assert/strict';
import { withResolution } from '../src/metadata.js';
import { png } from '../../desktop/tests/fixtures.mjs';
test('mobile PNG export writes document resolution without changing compressed pixels', () => {
  const original = png(4, 4), tagged = withResolution(original, 'png', 300);
  const chunk = Buffer.from(tagged).indexOf('pHYs'); assert.ok(chunk > 0);
  assert.equal(new DataView(tagged.buffer).getUint32(chunk + 4), 11811);
  const idat = original.indexOf('IDAT'), taggedIDAT = Buffer.from(tagged).indexOf('IDAT');
  assert.deepEqual(Buffer.from(tagged.subarray(taggedIDAT)), original.subarray(idat));
  assert.equal(withResolution(tagged, 'png', 144).length, tagged.length);
});
test('mobile JPEG resolution updates density while preserving the scan', () => {
  const jpeg = new Uint8Array([255,216,255,224,0,16,74,70,73,70,0,1,1,0,0,1,0,1,0,0,255,218,0,2,12,34,255,217]);
  const tagged = withResolution(jpeg, 'jpeg', 300); assert.deepEqual([...tagged.slice(13, 18)], [1,1,44,1,44]); assert.deepEqual(tagged.slice(20), jpeg.slice(20));
});
