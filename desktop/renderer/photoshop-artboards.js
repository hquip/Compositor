import { readPsd, writePsd } from './vendor/psd.js';
import { decodeCroppedChannel } from './psd-channels.js';
import { base64Bytes } from './precision-raster.js';
import { binaryBase64 } from './psd-export.js';
import { parsePhotoshop } from './photoshop.js';
import { photoshopProfile } from './photoshop-extended.js';
import { channelPreview } from './channel-workflows.js';
import { encodeChannelSource } from './channel-source.js';
import { profileBytes } from './color-engine.js';
import { addResource } from './workflow-assets.js';
import { canvasSize } from './core.js';

async function croppedSamples(channel, width, height, crop, bits, large) {
  const step=bits/8,result=new Uint8Array(crop.width*crop.height*step);
  if(channel.compression<2)return decodeCroppedChannel(channel,width*step,height,{x:crop.x*step,y:crop.y,width:crop.width*step,height:crop.height},large);
  const stream=new Blob([channel.data]).stream().pipeThrough(new DecompressionStream('deflate')),reader=stream.getReader(),row=new Uint8Array(width*step);let rowAt=0,y=0;
  try { while(y<crop.y+crop.height){const chunk=await reader.read();if(chunk.done)break;let at=0;
      while(at<chunk.value.length && y<crop.y+crop.height){const count=Math.min(row.length-rowAt,chunk.value.length-at);row.set(chunk.value.subarray(at,at+count),rowAt);rowAt+=count;at+=count;
        if(rowAt===row.length){
          if(channel.compression===3){if(bits===16){const view=new DataView(row.buffer);let previous=0;for(let x=0;x<width;x++){previous=(previous+view.getUint16(x*2))&65535;view.setUint16(x*2,previous);}}
            else for(let x=1;x<row.length;x++)row[x]=(row[x]+row[x-1])&255;}
          if(y>=crop.y){const destination=(y-crop.y)*crop.width*step;
            if(bits===32 && channel.compression===3){for(let x=0;x<crop.width;x++)for(let c=0;c<4;c++)result[destination+x*4+c]=row[c*width+crop.x+x];}
            else result.set(row.subarray(crop.x*step,(crop.x+crop.width)*step),destination);}
          y++;rowAt=0;
        }
      }
    }
    if(y<crop.y+crop.height)throw new Error('The Photoshop channel is truncated.');
  } finally { await reader.cancel().catch(()=>{});reader.releaseLock(); }
  return result;
}
export async function parsePhotoshopArtboards(encoded,budget) {
  const original=base64Bytes(encoded),header=new DataView(original.buffer),mode={3:'RGB',4:'CMYK',9:'Lab'}[header.getUint16(24)],bits=header.getUint16(22);if(!mode||![8,16,32].includes(bits))return null;
  const patched=original.slice();new DataView(patched.buffer).setUint16(24,3);
  const psd=readPsd(patched,{useRawData:true,useImageData:true,skipCompositeImageData:true,skipThumbnail:true});const boards=[];
  function find(nodes){for(const node of nodes??[]){if(node.artboard?.rect)boards.push(node);else if(node.children)find(node.children);}}find(psd.children);if(!boards.length)return null;
  const profile=photoshopProfile(original)??(mode==='RGB'?await profileBytes('sRGB'):null);if(mode==='CMYK'&&!profile)throw new Error('Artboards in a CMYK document require an embedded ICC profile.');
  const documents=[];
  for(const board of boards){const bounds=board.artboard.rect,width=bounds.right-bounds.left,height=bounds.bottom-bounds.top;canvasSize(width,height);if(width*height>16000000)throw new Error('A Photoshop artboard exceeds the precision pixel limit.');const sources=[];let used=0;
    async function cropMask(node,input){
      const mask=input.mask,entry=input.rawData?.channels?.find((c)=>c.id===-2);if(!mask||!entry)return;
      const left=Math.max(bounds.left,mask.left??bounds.left),top=Math.max(bounds.top,mask.top??bounds.top),right=Math.min(bounds.right,mask.right??bounds.right),bottom=Math.min(bounds.bottom,mask.bottom??bounds.bottom);
      if(right<=left||bottom<=top){node.mask={...mask,left:0,top:0,right:1,bottom:1,imageData:{width:1,height:1,data:new Uint8ClampedArray([mask.defaultColor??255,mask.defaultColor??255,mask.defaultColor??255,255])}};return;}
      const crop={x:left-(mask.left??0),y:top-(mask.top??0),width:right-left,height:bottom-top},bytes=await croppedSamples(entry,(mask.right??0)-(mask.left??0),(mask.bottom??0)-(mask.top??0),crop,bits,input.rawData.large),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),data=new Uint8ClampedArray(crop.width*crop.height*4);
      for(let i=0;i<crop.width*crop.height;i++){const value=bits===8?bytes[i]:bits===16?view.getUint16(i*2)/257:view.getFloat32(i*4)*255;data.set([value,value,value,255],i*4);}node.mask={...mask,left:left-bounds.left,top:top-bounds.top,right:right-bounds.left,bottom:bottom-bounds.top,positionRelativeToLayer:false,imageData:{width:crop.width,height:crop.height,data}};
    }
    async function cropNodes(nodes){const result=[];for(const input of nodes??[]){const node={...input};delete node.artboard;await cropMask(node,input);if(node.children){node.children=await cropNodes(node.children);delete node.rawData;result.push(node);continue;}const w=(node.right??0)-(node.left??0),h=(node.bottom??0)-(node.top??0),left=Math.max(bounds.left,node.left??0),top=Math.max(bounds.top,node.top??0),right=Math.min(bounds.right,node.right??0),bottom=Math.min(bounds.bottom,node.bottom??0);if(right<=left||bottom<=top)continue;
      const crop={x:left-(node.left??0),y:top-(node.top??0),width:right-left,height:bottom-top},channels=mode==='CMYK'?5:4,data=new Float32Array(crop.width*crop.height*channels);for(let i=channels-1;i<data.length;i+=channels)data[i]=1;
      used+=crop.width*crop.height*channels*bits/32;if(used>budget)throw new Error('This artboard exceeds the document pixel budget.');
      for(const entry of node.rawData?.channels??[]){const c=entry.id===-1?channels-1:entry.id;if(c<0||c>=channels)continue;const bytes=await croppedSamples(entry,w,h,crop,bits,node.rawData.large),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);for(let i=0;i<crop.width*crop.height;i++){let value=bits===8?bytes[i]/255:bits===16?view.getUint16(i*2)/65535:view.getFloat32(i*4);if(c!==channels-1){if(mode==='CMYK')value=1-value;if(mode==='Lab')value=c===0?value*100:value*255-128;}data[i*channels+c]=value;}}
      const source={width:crop.width,height:crop.height,mode,bits,channels,data},image=await channelPreview(source,profile);node.imageData=image.getContext('2d').getImageData(0,0,image.width,image.height);node.left=left-bounds.left;node.top=top-bounds.top;node.right=right-bounds.left;node.bottom=bottom-bounds.top;delete node.rawData;
      result.push(node);sources.push(source);
    }return result;}
    const converted={width,height,bitsPerChannel:8,colorMode:3,children:await cropNodes(board.children),imageResources:psd.imageResources},parsed=parsePhotoshop(binaryBase64(new Uint8Array(writePsd(converted,{psb:header.getUint16(4)===2,generateThumbnail:false}))),budget),holder={manifest:parsed.snapshot.manifest,assets:parsed.snapshot.assets};
    const file=addResource(holder,original,'photoshop'),profileFile=profile&&addResource(holder,profile,'icc');let index=0;for(const layer of [...parsed.snapshot.manifest.layers].reverse()){if(layer.isGroup||!layer.imageFile)continue;const source=sources[index++];if(bits!==8||mode!=='RGB')layer.workflow={type:'channels',channelFile:addResource(holder,encodeChannelSource(source),'channels'),profileFile:profileFile||undefined,mode,bits};}
    parsed.snapshot.manifest.workflow={colorMode:mode,bits,profileFile:profileFile||undefined,photoshop:{file,artboard:{name:board.name,rect:bounds},originalLayers:structuredClone(parsed.snapshot.manifest.layers)}};documents.push({name:board.name||'Artboard',...parsed});
  }
  return documents;
}
