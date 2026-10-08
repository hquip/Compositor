import { zipSync, unzipSync, strToU8 } from './vendor/archive.js';
import { createManifest, createLayer, canvasSize, BLEND_MODES } from './core.js';
import { surface, place } from './raster.js';
import { compose, decodeImage } from './compose.js';
import { base64Bytes } from './precision-raster.js';
import { binaryBase64 } from './psd-export.js';

const modeToSVG = Object.fromEntries(BLEND_MODES.map((name) => [name, 'svg:' + name.toLowerCase().replaceAll(' ', '-')])); modeToSVG.Normal = 'svg:src-over';
const svgToMode = Object.fromEntries(Object.entries(modeToSVG).map(([a,b]) => [b,a]));
const xml = (value) => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function encodeOpenRaster(editor) {
  const manifest = editor.manifest, files = { mimetype: strToU8('image/openraster') }, image = editor.composite(true);
  files['mergedimage.png'] = base64Bytes(image.toDataURL('image/png').split(',')[1]);
  const thumbnailFactor = Math.min(1, 256 / Math.max(manifest.width, manifest.height)), thumbnail = surface(Math.max(1, Math.round(manifest.width * thumbnailFactor)), Math.max(1, Math.round(manifest.height * thumbnailFactor))); thumbnail.getContext('2d').drawImage(image,0,0,thumbnail.width,thumbnail.height); files['Thumbnails/thumbnail.png'] = base64Bytes(thumbnail.toDataURL('image/png').split(',')[1]);
  let counter = 0;
  function stack(parent) {
    return manifest.layers.filter((layer)=>(layer.parentID??null)===(parent??null)).reverse().map((layer)=>{
      const common=` name="${xml(layer.name)}" opacity="${layer.opacity??1}" visibility="${layer.isVisible?'visible':'hidden'}" composite-op="${modeToSVG[layer.blendMode]??'svg:src-over'}"`;
      if(layer.isGroup) return `<stack${common}>${stack(layer.id)}</stack>`;
      let content;
      if (layer.adjustment || ['lut','live-filter'].includes(layer.workflow?.type)) return '';
      const source=editor.images.get(layer.id); if(!source) return '';
      content=compose({...manifest,layers:[{...layer,parentID:undefined,opacity:1,isVisible:true,maskSourceID:undefined}]},editor.images,editor.masks,1,editor.assets);
      const path=`data/layer${counter++}.png`; files[path]=base64Bytes(content.toDataURL('image/png').split(',')[1]); return `<layer${common} src="${path}" x="0" y="0"/>`;
    }).join('');
  }
  files['stack.xml']=strToU8(`<?xml version="1.0" encoding="UTF-8"?><image version="0.0.3" w="${manifest.width}" h="${manifest.height}" name="${xml(editor.name)}"><stack>${stack(undefined)}</stack></image>`);
  const snapshot=editor.projectSnapshot(); files['compositor/manifest.json']=strToU8(JSON.stringify(snapshot.manifest));
  for(const [name,encoded] of Object.entries(snapshot.assets)) files['compositor/images/'+name]=base64Bytes(encoded);
  return zipSync(files,{level:0});
}
export async function decodeOpenRaster(bytes, budget=48000000) {
  let total=0; const files=unzipSync(bytes,{filter(entry){total+=entry.originalSize; if(total>256*1024*1024 || entry.name.startsWith('/') || entry.name.includes('\\') || entry.name.split('/').some((part)=>part==='..') || !Number.isFinite(total)) throw new Error('Invalid or oversized OpenRaster archive.'); return true;}});
  if(new TextDecoder().decode(files.mimetype??new Uint8Array())!=='image/openraster' || !files['stack.xml']) throw new Error('This is not an OpenRaster image.');
  if(files['compositor/manifest.json']) {
    const manifest=JSON.parse(new TextDecoder().decode(files['compositor/manifest.json'])), assets={};
    for(const [name,data] of Object.entries(files)) if(name.startsWith('compositor/images/')) assets[name.slice(18)]=binaryBase64(data);
    return {manifest,assets};
  }
  const doc=new DOMParser().parseFromString(new TextDecoder().decode(files['stack.xml']),'application/xml');
  if(doc.querySelector('parsererror') || doc.doctype || doc.documentElement.tagName!=='image') throw new Error('Invalid OpenRaster layer XML.');
  const width=Number(doc.documentElement.getAttribute('w')),height=Number(doc.documentElement.getAttribute('h'));canvasSize(width,height);
  const manifest=createManifest(width,height),assets={}; let pixels=0, count=0;
  async function visit(element,parentID,depth) {
    if(depth>64) throw new Error('OpenRaster folders are nested too deeply.');
    for(const node of [...element.children].reverse()) {
      if(!['layer','stack'].includes(node.tagName)) continue; if(++count>10000) throw new Error('OpenRaster has too many layers.');
      const layer=createLayer(node.getAttribute('name')||'Layer',width,height),opacity=Number(node.getAttribute('opacity')??1); if(!Number.isFinite(opacity)||opacity<0||opacity>1) throw new Error('Invalid OpenRaster layer opacity.');
      layer.parentID=parentID;layer.opacity=opacity;layer.isVisible=node.getAttribute('visibility')!=='hidden';layer.blendMode=svgToMode[node.getAttribute('composite-op')]??'Normal';
      if(node.tagName==='stack'){layer.isGroup=true;layer.blendMode='Normal';manifest.layers.push(layer);await visit(node,layer.id,depth+1);}
      else {const data=files[node.getAttribute('src')];if(!data)throw new Error('An OpenRaster layer image is missing.');const image=await decodeImage('data:image/png;base64,'+binaryBase64(data));pixels+=image.naturalWidth*image.naturalHeight;if(pixels>budget)throw new Error('OpenRaster exceeds the document pixel budget.');const x=Number(node.getAttribute('x')??0),y=Number(node.getAttribute('y')??0);if(!Number.isFinite(x)||!Number.isFinite(y)||Math.abs(x)>1000000||Math.abs(y)>1000000)throw new Error('Invalid OpenRaster layer placement.');layer.transform.origin=[x,y];layer.transform.size=[image.naturalWidth,image.naturalHeight];layer.imageFile=layer.id+'.png';assets[layer.imageFile]=binaryBase64(data);manifest.layers.push(layer);}
    }
  }
  const stack=doc.documentElement.querySelector(':scope > stack');if(!stack)throw new Error('OpenRaster layer stack is missing.');await visit(stack,undefined,0);manifest.activeLayerID=manifest.layers.at(-1)?.id??null;return{manifest,assets};
}
