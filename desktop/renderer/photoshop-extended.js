import { readPsd, writePsd, getLayerImageData, getLayerMaskImageData } from './vendor/psd.js';
import { parsePhotoshop } from './photoshop.js';
import { base64Bytes } from './precision-raster.js';
import { binaryBase64 } from './psd-export.js';
import { encodeChannelSource } from './channel-source.js';
import { channelPreview } from './channel-workflows.js';
import { profileBytes, validateProfile } from './color-engine.js';
import { addResource } from './workflow-assets.js';

export function photoshopProfile(bytes) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let at=26;
  const modeLength=view.getUint32(at);at+=4+modeLength;const size=view.getUint32(at);at+=4;const end=at+size;
  while(at+12<=end){const id=view.getUint16(at+4),nameLength=bytes[at+6];at+=6+Math.ceil((nameLength+1)/2)*2;const length=view.getUint32(at);at+=4;if(at+length>end)throw new Error('Invalid Photoshop image resources.');if(id===1039)return bytes.slice(at,at+length);at+=length+(length%2);}
  return null;
}
export function decodePhotoshopLayer(source, mode, bits) {
  const width=Math.max(0,(source.right??0)-(source.left??0)),height=Math.max(0,(source.bottom??0)-(source.top??0)),channels=mode==='CMYK'?5:4;
  if(!width||!height)return null;if(width*height>16000000)throw new Error('A Photoshop precision layer exceeds 16 megapixels.');
  const data=new Float32Array(width*height*channels),maximum=bits===8?255:bits===16?65535:1;
  for(let i=channels-1;i<data.length;i+=channels)data[i]=1;
  for(const channel of source.rawData?.channels??[]){let component=channel.id===-1?channels-1:channel.id;if(component<0||component>=channels)continue;
    const fake={left:0,top:0,right:width,bottom:height,rawData:{...source.rawData,colorMode:3,channels:[{...channel,id:0}]}},image=getLayerImageData(fake);if(!image)continue;
    for(let i=0;i<width*height;i++){let value=image.data[i*4]/maximum;if(component!==channels-1){if(mode==='CMYK')value=1-value;if(mode==='Lab')value=component===0?value*100:value*255-128;}data[i*channels+component]=value;}
  }
  return {width,height,mode,bits,channels,data};
}
export async function parsePhotoshopExtended(encoded, budget, overrideProfile) {
  const original=base64Bytes(encoded),view=new DataView(original.buffer,original.byteOffset,original.byteLength),bits=view.getUint16(22),modeCode=view.getUint16(24),mode={3:'RGB',4:'CMYK',9:'Lab'}[modeCode];
  if(!mode||![8,16,32].includes(bits))throw new Error('Unsupported Photoshop color mode or channel depth.');
  if(bits===8&&mode==='RGB'){
    const parsed=parsePhotoshop(encoded,budget),holder={manifest:parsed.snapshot.manifest,assets:parsed.snapshot.assets};const file=addResource(holder,original,'photoshop');parsed.snapshot.manifest.workflow={photoshop:{file,originalLayers:structuredClone(parsed.snapshot.manifest.layers)}};return parsed;
  }
  const patched=original.slice();new DataView(patched.buffer).setUint16(24,3);
  const psd=readPsd(patched,{useRawData:true,useImageData:true,skipCompositeImageData:true,skipThumbnail:true,logMissingFeatures:false});
  const profile=overrideProfile??photoshopProfile(original)??(mode==='RGB'?await profileBytes('sRGB'):null);
  if(mode==='CMYK'&&(!profile||validateProfile(profile)!=='CMYK'))throw new Error('This CMYK Photoshop document needs an embedded or selected CMYK ICC profile.');
  const sources=[];let used=0;
  async function visit(nodes){for(const node of nodes??[]){if(node.children){await visit(node.children);continue;}const source=decodePhotoshopLayer(node,mode,bits);if(!source)continue;used+=source.width*source.height*source.channels*bits/32;if(used>budget)throw new Error('The Photoshop channel sources exceed the document pixel budget.');const preview=await channelPreview(source,profile);node.imageData=preview.getContext('2d').getImageData(0,0,preview.width,preview.height);sources.push({name:node.name,source});
    if(node.mask){const mask=getLayerMaskImageData(node);if(mask){node.mask.imageData={width:mask.width,height:mask.height,data:Uint8ClampedArray.from(mask.data,(v,i)=>i%4===3?255:v/(bits===16?257:bits===32?1/255:1))};}}
    delete node.rawData;}
  }
  await visit(psd.children);psd.bitsPerChannel=8;psd.colorMode=3;
  const parsed=parsePhotoshop(binaryBase64(new Uint8Array(writePsd(psd,{generateThumbnail:false,psb:view.getUint16(4)===2}))),budget),holder={manifest:parsed.snapshot.manifest,assets:parsed.snapshot.assets};
  const originalFile=addResource(holder,original,'photoshop'),profileFile=profile&&addResource(holder,profile,'icc');let index=0;
  for(const layer of [...parsed.snapshot.manifest.layers].reverse()){if(layer.isGroup||!layer.imageFile)continue;const match=sources[index++];if(!match)continue;layer.workflow={type:'channels',channelFile:addResource(holder,encodeChannelSource(match.source),'channels'),profileFile:profileFile||undefined,mode,bits};}
  parsed.snapshot.manifest.workflow={colorMode:mode,bits,profileFile:profileFile||undefined,photoshop:{file:originalFile,originalLayers:structuredClone(parsed.snapshot.manifest.layers)}};
  parsed.report.push(`${bits}-bit ${mode} channel sources and original Photoshop structures are retained.`);return parsed;
}
