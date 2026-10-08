import test from 'node:test';
import assert from 'node:assert/strict';
import { dodgeBurnPixels } from '../renderer/dodge-burn.js';
import { resolveTheme } from '../renderer/theme.js';
import { parseCube, lookupColor, applyLookup } from '../renderer/lut.js';
import { randomUUID } from 'node:crypto';
import { encodeProject, decodeProject } from '../../mobile/src/archive.js';
import { compatibilityFixture } from './compatibility-fixture.mjs';
import store from '../lib/project.cjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { encodeChannelSource, decodeChannelSource, channelValue } from '../renderer/channel-source.js';
import { convertFloatChannels, profileBytes } from '../renderer/color-engine.js';
import { collageRects, rectifyPixels } from '../renderer/layout-workflows.js';
import { surface } from '../renderer/raster.js';
import { encodePNG8, decodePNG } from '../renderer/png-pixels.js';
import { latestRelease } from '../renderer/update-notes.js';
import { canonicalRuns, replaceTextContent, textSpans } from '../renderer/text-style.js';

test('Dodge/Burn apply tonal ranges, preserve alpha and leave uncovered pixels intact', () => {
  const pixels = new Uint8ClampedArray([32, 32, 32, 255, 128, 128, 128, 128, 230, 230, 230, 255, 80, 100, 150, 0]);
  for (const range of ['Shadows', 'Midtones', 'Highlights']) {
    const dodge = dodgeBurnPixels(pixels, new Uint8Array([255, 255, 255, 255]), 'Dodge', range, 50);
    const burn = dodgeBurnPixels(pixels, new Uint8Array([255, 255, 255, 255]), 'Burn', range, 50);
    for (const at of [0, 4, 8]) { assert.ok(dodge[at] >= pixels[at]); assert.ok(burn[at] <= pixels[at]); assert.equal(dodge[at + 3], pixels[at + 3]); assert.equal(burn[at + 3], pixels[at + 3]); }
    assert.deepEqual(dodge.slice(12), pixels.slice(12));
  }
  assert.deepEqual(dodgeBurnPixels(pixels, new Uint8Array([255, 255, 255, 255]), 'Dodge', 'Midtones', 0), pixels);
  assert.deepEqual(dodgeBurnPixels(pixels, new Uint8Array(4), 'Dodge', 'Midtones', 100), pixels);
  assert.throws(() => dodgeBurnPixels(pixels, new Uint8Array(4), 'Dodge', 'Bad', 50));
});

test('system appearance follows the operating system and explicit choices override it', () => {
  assert.equal(resolveTheme('System', true), 'dark'); assert.equal(resolveTheme('System', false), 'light');
  assert.equal(resolveTheme('Dark', false), 'dark'); assert.equal(resolveTheme('Light', true), 'light');
});

test('cube tables interpolate all axes, retain alpha and refuse truncated samples', () => {
  const table = parseCube('TITLE "Invert"\nLUT_3D_SIZE 2\n' + [[1,1,1],[0,1,1],[1,0,1],[0,0,1],[1,1,0],[0,1,0],[1,0,0],[0,0,0]].map((v) => v.join(' ')).join('\n'));
  assert.deepEqual(lookupColor(table, [.25, .5, .75]), [.75, .5, .25]);
  assert.deepEqual([...applyLookup(new Uint8ClampedArray([255,0,0,128]), table)], [0,255,255,128]);
  assert.throws(() => parseCube('LUT_3D_SIZE 2\n0 0 0'));
  const one = parseCube('LUT_1D_SIZE 2\n0 0 0\n1 1 1'); assert.deepEqual(lookupColor(one, [.25,.5,.75]), [.25,.5,.75]);
});

test('format 17 LUT resources and layer Fill survive desktop and mobile archives', async () => {
  const snapshot = compatibilityFixture(); snapshot.manifest.version = 17;
  const file = randomUUID().toUpperCase() + '.resource.bin'; snapshot.manifest.resources = [{ file, kind: 'lookup' }];
  snapshot.assets[file] = Buffer.from('LUT_1D_SIZE 2\n0 0 0\n1 1 1').toString('base64'); snapshot.manifest.layers[0].workflow = { type: 'lut', file }; snapshot.manifest.layers[0].fillOpacity = .5;
  assert.deepEqual(decodeProject(encodeProject(snapshot)), snapshot);
  const directory = await mkdtemp(path.join(tmpdir(), 'compositor-workflows-'));
  try { const target = path.join(directory, 'Resources.comp'); await store.writeProject(target, snapshot); assert.deepEqual(await store.readProject(target), snapshot); }
  finally { await rm(directory, { recursive: true, force: true }); }
});

test('authoritative RGB/CMYK/Lab channels retain precision, ranges and independent alpha', () => {
  for (const mode of ['RGB', 'CMYK', 'Lab']) for (const bits of [8,16,32]) {
    const channels = mode === 'CMYK' ? 5 : 4, values = mode === 'CMYK' ? [.1,.2,.3,.4,.5] : mode === 'Lab' ? [50,-25,30,.5] : [.1,.2,.3,.5];
    const source = { width: 1, height: 1, channels, mode, bits, data: new Float32Array(values) }, decoded = decodeChannelSource(encodeChannelSource(source));
    for (let c = 0; c < channels; c++) assert.ok(Math.abs(decoded.data[c] - values[c]) < (bits === 8 ? mode === 'Lab' && c < 3 ? 1 : .005 : bits === 16 ? .005 : .00001));
    const alpha = decoded.data[channels-1]; channelValue(decoded,0,0,1); assert.equal(decoded.data[channels-1],alpha);
  }
});

test('floating ICC conversion supports Lab without reducing RGB samples to 8 bits', async () => {
  const rgb = new Float32Array([.12543,.5,.87654]), profile = await profileBytes('sRGB');
  const lab = await convertFloatChannels(rgb,'RGB','Lab',profile,null), reopened = await convertFloatChannels(lab,'Lab','RGB',null,profile);
  assert.ok(lab[0]>0 && lab[0]<100); for(let i=0;i<3;i++) assert.ok(Math.abs(reopened[i]-rgb[i])<.001);
});

test('collage cells maintain spacing and perspective crop validates the four-point surface', () => {
  const cells = collageRects(4,100,100,2,10,5); assert.deepEqual(cells[0],{x:5,y:5,width:40,height:40}); assert.equal(cells[1].x,55); assert.equal(cells[2].y,55);
  assert.throws(()=>collageRects(4,10,10,2,10,5));
  const image=surface(2,2), ctx=image.getContext('2d'), pixels=ctx.createImageData(2,2); pixels.data.set([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]); ctx.putImageData(pixels,0,0);
  const rectified=rectifyPixels(image,[{x:0,y:0},{x:2,y:0},{x:2,y:2},{x:0,y:2}],2,2); assert.deepEqual([...rectified.getContext('2d').getImageData(0,0,2,2).data],[...pixels.data]);
  assert.throws(()=>rectifyPixels(image,[{x:0,y:0},{x:2,y:2},{x:2,y:0},{x:0,y:2}],2,2));
});

test('eight-bit PNG encoding retains the exact alpha and color samples for automation', async () => {
  const original = new Uint8ClampedArray([12,34,56,78,255,0,1,255]);
  const decoded = await decodePNG(await encodePNG8({ width:2,height:1,data:original })); assert.deepEqual([...decoded.data], [...original].map((v)=>v*257));
});

test('release notes are retrieved as text and unexpected download origins are refused', async () => {
  const release = await latestRelease(async () => ({ ok:true,json:async()=>({tag_name:'v0.11.0',body:'New channels',html_url:'https://github.com/hquip/Compositor/releases/tag/v0.11.0'}) })); assert.equal(release.notes,'New channels');
  await assert.rejects(()=>latestRelease(async()=>({ok:true,json:async()=>({tag_name:'v1',html_url:'https://example.com/file'})})));
});

test('mixed font sizes rebase through text edits and preserve style span boundaries', () => {
  const style={content:'ABCD',fontName:'Arial',fontSize:20,red:0,green:0,blue:0,sizeRuns:[{location:1,length:2,fontSize:40}]};
  const result=replaceTextContent(style,'A!BCD'); assert.deepEqual(result.sizeRuns,[{location:2,length:2,fontSize:40}]); assert.deepEqual(textSpans(style).map((span)=>[span.text,span.fontSize]),[['A',20],['BC',40],['D',20]]);
});
