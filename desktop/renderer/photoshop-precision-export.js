import { writePsd, getLayerImageData } from './vendor/psd.js';
import { buildPhotoshop } from './psd-export.js';
import { decodeChannelSource } from './channel-source.js';
import { resourceBytes } from './workflow-assets.js';
import { localPoint } from './core.js';

const concatenate = (parts) => { const out = new Uint8Array(parts.reduce((n,p)=>n+p.length,0)); let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out; };
const number = (n,size=4) => {const bytes=new Uint8Array(size),v=new DataView(bytes.buffer);if(size===8)v.setBigUint64(0,BigInt(n));else if(size===2)v.setUint16(0,n);else v.setUint32(0,n);return bytes;};
function plane(source,channel,bits,mode) {
  const out=new Uint8Array(source.length*bits/8),v=new DataView(out.buffer);
  for(let i=0;i<source.length;i++){let value=source[i];if(channel>=0){if(mode==='CMYK')value=1-value;if(mode==='Lab')value=channel===0?value/100:(value+128)/255;}
    if(bits===8)out[i]=Math.round(Math.max(0,Math.min(1,value))*255);else if(bits===16)v.setUint16(i*2,Math.round(Math.max(0,Math.min(1,value))*65535));else v.setFloat32(i*4,value);}
  return concatenate([number(0,2),out]);
}
export function patchPhotoshopDepth(bytes, layers, composite, mode, bits, profile) {
  const original=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),large=original.getUint16(4)===2,lengthBytes=large?8:4;
  const readLength=(at)=>{const n=large?Number(original.getBigUint64(at)):original.getUint32(at);if(!Number.isSafeInteger(n)||n<0||n>bytes.length)throw new Error('Invalid Photoshop section length.');return n;};
  let at=26;at+=4+original.getUint32(at);at+=4+original.getUint32(at);const sectionStart=at,sectionLength=readLength(at);at+=lengthBytes;
  const layerInfoLength=readLength(at);at+=lengthBytes;const layerStart=at,count=original.getInt16(at);at+=2;const records=[];
  for(let i=0;i<Math.abs(count);i++){
    const start=at,top=original.getInt32(at),left=original.getInt32(at+4),bottom=original.getInt32(at+8),right=original.getInt32(at+12);at+=16;const channels=original.getUint16(at);at+=2;const channelInfo=[];
    for(let c=0;c<channels;c++){const id=original.getInt16(at);at+=2;const length=readLength(at);at+=lengthBytes;channelInfo.push({id,length});}
    const extraStart=at;at+=12;const extraLength=original.getUint32(at);at+=4;const end=at+extraLength;if(end>bytes.length)throw new Error('Invalid Photoshop layer extras.');
    let nameAt=at+4+original.getUint32(at);nameAt+=4+original.getUint32(nameAt);const nameLength=bytes[nameAt];let name=new TextDecoder('ascii').decode(bytes.slice(nameAt+1,nameAt+1+nameLength));nameAt+=Math.ceil((nameLength+1)/4)*4;
    while(nameAt+12<=end){const signature=new TextDecoder().decode(bytes.slice(nameAt,nameAt+4)),key=new TextDecoder().decode(bytes.slice(nameAt+4,nameAt+8));if(!['8BIM','8B64'].includes(signature))break;const len=original.getUint32(nameAt+8);if(key==='luni'&&len>=4){const size=original.getUint32(nameAt+12);let text='';for(let c=0;c<size;c++)text+=String.fromCharCode(original.getUint16(nameAt+16+c*2));name=text;}nameAt+=12+len+(len%2);}
    at=end;records.push({bounds:bytes.slice(start,start+16),extra:bytes.slice(extraStart,end),channelInfo,name,left,top,width:right-left,height:bottom-top});
  }
  const dataStart=at;let consumed=0;for(const record of records){record.originalChannels=record.channelInfo.map((entry)=>{const data=bytes.slice(dataStart+consumed,dataStart+consumed+entry.length);consumed+=entry.length;return{...entry,data};});}
  const seen=new Set(),recordBytes=[],channelBytes=[];
  for(const record of records){const match=layers.find((layer)=>!seen.has(layer.id)&&layer.name===record.name&&layer.source);if(match)seen.add(match.id);let channels;
    if(match&&record.width>0&&record.height>0){const source=match.source,samples=Array.from({length:source.channels},()=>new Float32Array(record.width*record.height));
      for(let y=0;y<record.height;y++)for(let x=0;x<record.width;x++){const p=localPoint({x:record.left+x+.5,y:record.top+y+.5},match.transform,source.width,source.height),sx=Math.floor(p.x),sy=Math.floor(p.y);if(sx<0||sy<0||sx>=source.width||sy>=source.height)continue;for(let c=0;c<source.channels;c++)samples[c][y*record.width+x]=source.data[(sy*source.width+sx)*source.channels+c];}
      channels=Array.from({length:source.channels},(_,c)=>({id:c===source.channels-1?-1:c,data:plane(samples[c],c===source.channels-1?-1:c,bits,mode)}));
      for(const mask of record.originalChannels.filter((entry)=>entry.id<-1)) {
        const extraView=new DataView(record.extra.buffer,record.extra.byteOffset,record.extra.byteLength),maskLength=extraView.getUint32(16);if(maskLength<18)throw new Error('Invalid Photoshop mask bounds.');
        const maskWidth=extraView.getInt32(32)-extraView.getInt32(24),maskHeight=extraView.getInt32(28)-extraView.getInt32(20);
        if(maskWidth<1||maskHeight<1)continue;const compression=new DataView(mask.data.buffer,mask.data.byteOffset,mask.data.byteLength).getUint16(0);
        const image=getLayerImageData({left:0,top:0,right:maskWidth,bottom:maskHeight,rawData:{colorMode:3,bitsPerChannel:8,large,channels:[{id:0,compression,data:mask.data.slice(2)}]}});
        const values=Float32Array.from({length:maskWidth*maskHeight},(_,i)=>image.data[i*4]/255);channels.push({id:mask.id,data:plane(values,-1,bits,mode)});
      }
    }else if(record.width===0||record.height===0){channels=record.originalChannels.map((entry)=>({...entry,data:new Uint8Array()}));}
    else if(bits===8&&mode==='RGB')channels=record.originalChannels;
    else throw new Error('A Photoshop precision layer has no authoritative channel source.');
    recordBytes.push(concatenate([record.bounds,number(channels.length,2),...channels.map((c)=>concatenate([number(c.id&65535,2),number(c.data.length,lengthBytes)])),record.extra]));channelBytes.push(...channels.map((c)=>c.data));
  }
  let info=concatenate([number(count&65535,2),...recordBytes,...channelBytes]);if(info.length%2)info=concatenate([info,new Uint8Array(1)]);
  const tail=bytes.slice(layerStart+layerInfoLength,sectionStart+lengthBytes+sectionLength);
  const section=bits===8?concatenate([number(info.length,lengthBytes),info,tail]):concatenate([number(0,lengthBytes),tail,new TextEncoder().encode('8BIM'+(bits===16?'Lr16':'Lr32')),number(info.length,lengthBytes),info]);
  let header=bytes.slice(0,sectionStart);
  if(profile){const resourceAt=26+4+original.getUint32(26),resourcesEnd=resourceAt+4+original.getUint32(resourceAt),resource=concatenate([new TextEncoder().encode('8BIM'),number(1039,2),new Uint8Array(2),number(profile.length),profile,...(profile.length%2?[new Uint8Array(1)]:[])]);header=concatenate([bytes.slice(0,resourceAt),number(original.getUint32(resourceAt)+resource.length),bytes.slice(resourceAt+4,resourcesEnd),resource]);}
  const headerView=new DataView(header.buffer);headerView.setUint16(12,composite.channels);headerView.setUint16(22,bits);headerView.setUint16(24,{RGB:3,CMYK:4,Lab:9}[mode]);
  const merged=[];for(let c=0;c<composite.channels;c++){const values=Float32Array.from({length:composite.width*composite.height},(_,i)=>composite.data[i*composite.channels+c]);merged.push(plane(values,c===composite.channels-1?-1:c,bits,mode).slice(2));}
  return concatenate([header,number(section.length,lengthBytes),section,number(0,2),...merged]);
}
export function precisionPhotoshopSources(editor) {
  return editor.manifest.layers.filter((layer)=>layer.workflow?.channelFile).reverse().map((layer)=>({id:layer.id,name:layer.name,transform:layer.transform,source:decodeChannelSource(resourceBytes(editor.assets,layer.workflow.channelFile))}));
}
