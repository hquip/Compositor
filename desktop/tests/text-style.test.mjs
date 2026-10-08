import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceTextContent, normalizedTextStyle, fontDescriptor } from '../renderer/text-style.js';
const style = { content: 'A😀BC', fontName: 'ArialMT', fontSize: 24, red: 0, green: 0, blue: 0,
  fontRuns: [{ location: 1, length: 2, fontName: 'CourierNewPSMT' }], colorRuns: [{ location: 3, length: 2, red: 1, green: 0, blue: 0 }] };
test('inserting and deleting text rebases UTF-16 font and color ranges without mutating the original', () => {
  const before = structuredClone(style), inserted = replaceTextContent(style, 'A😀xBC');
  assert.deepEqual(inserted.fontRuns, [{ location: 1, length: 3, fontName: 'CourierNewPSMT' }]);
  assert.deepEqual(inserted.colorRuns, [{ location: 4, length: 2, red: 1, green: 0, blue: 0 }]);
  const deleted = replaceTextContent(style, 'AC'); assert.equal(deleted.fontRuns, undefined); assert.deepEqual(deleted.colorRuns, [{ location: 1, length: 1, red: 1, green: 0, blue: 0 }]); assert.deepEqual(style, before);
});
test('CRLF normalization keeps one break and remaps styled emoji offsets', () => {
  const value = normalizedTextStyle({ ...style, content: 'A\r\n😀B', fontRuns: [{ location: 3, length: 2, fontName: 'CourierNewPSMT' }], colorRuns: [{ location: 3, length: 2, red: 1, green: 0, blue: 0 }] });
  assert.equal(value.content, 'A\n😀B'); assert.equal(value.fontRuns[0].location, 2); assert.equal(value.colorRuns[0].location, 2); assert.equal(value.colorRuns[0].length, 2);
});
test('common Mac font faces retain bold and italic styling in browser fonts', () => {
  assert.deepEqual(fontDescriptor('Arial-BoldItalicMT'), { family: 'Arial', weight: '700', style: 'italic' });
  assert.deepEqual(fontDescriptor('CourierNewPS-BoldMT'), { family: 'Courier New', weight: '700', style: 'normal' });
  assert.equal(fontDescriptor('__proto__').family, '__proto__');
});
