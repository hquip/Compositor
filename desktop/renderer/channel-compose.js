import { localPoint, layerEntries, canvasSize } from './core.js';
import { convertFloatChannels, profileBytes } from './color-engine.js';
import { decodeChannelSource } from './channel-source.js';
import { resourceBytes } from './workflow-assets.js';

export async function composeChannels(editor, mode, bits, profile) {
  const width=editor.manifest.width,height=editor.manifest.height;canvasSize(width,height);if(width*height>16000000)throw new Error('Precision compositing supports up to 16 megapixels.');
  profile ??= mode==='RGB'?await profileBytes('sRGB'):null;
  const channels=mode==='CMYK'?5:4,result={width,height,mode,bits,channels,data:new Float32Array(width*height*channels)};
  for(const entry of layerEntries(editor.manifest.layers)){
    const layer=entry.layer;if(!entry.visible||layer.isGroup)continue;
    if(layer.adjustment||['lut','live-filter'].includes(layer.workflow?.type)||layer.effects||layer.maskSourceID||entry.ancestors.some((group)=>editor.masks.has(group.id)))throw new Error('This precision export requires rasterizing live adjustments, effects or clipping first.');
    if(!editor.images.has(layer.id))continue;if((layer.blendMode??'Normal')!=='Normal')throw new Error('This precision export currently requires Normal blend mode.');
    let source;
    if(layer.workflow?.channelFile)source=decodeChannelSource(resourceBytes(editor.assets,layer.workflow.channelFile));
    else {const image=editor.images.get(layer.id),pixels=image.getContext('2d').getImageData(0,0,image.width,image.height).data;source={width:image.width,height:image.height,mode:'RGB',channels:4,data:Float32Array.from(pixels,(v)=>v/255)};}
    const inputProfile=layer.workflow?.profileFile?resourceBytes(editor.assets,layer.workflow.profileFile):source.mode==='RGB'?await profileBytes('sRGB'):null;
    const sameProfile=inputProfile===profile || inputProfile && profile && inputProfile.length===profile.length && inputProfile.every((v,i)=>v===profile[i]);
    if(source.mode!==mode || !sameProfile){const values=new Float32Array(source.width*source.height*(source.channels-1));for(let i=0,j=0;i<source.data.length;i+=source.channels)for(let c=0;c<source.channels-1;c++)values[j++]=source.data[i+c];const colors=await convertFloatChannels(values,source.mode,mode,inputProfile,profile),data=new Float32Array(source.width*source.height*channels);for(let i=0;i<source.width*source.height;i++){for(let c=0;c<channels-1;c++)data[i*channels+c]=colors[i*(channels-1)+c];data[i*channels+channels-1]=source.data[i*source.channels+source.channels-1];}source={...source,mode,channels,data};}
    const mask=layer.maskEnabled!==false?editor.masks.get(layer.id):null,coverage=mask?.getContext('2d').getImageData(0,0,mask.width,mask.height).data;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=localPoint({x:x+.5,y:y+.5},layer.transform,source.width,source.height),sx=Math.floor(p.x),sy=Math.floor(p.y);if(sx<0||sy<0||sx>=source.width||sy>=source.height)continue;const at=(y*width+x)*channels,from=(sy*source.width+sx)*channels;let amount=source.data[from+channels-1]*entry.opacity*(layer.fillOpacity??1);if(mask){const m=localPoint({x:x+.5,y:y+.5},layer.maskPlacement??layer.transform,mask.width,mask.height),mx=Math.max(0,Math.min(mask.width-1,Math.floor(m.x))),my=Math.max(0,Math.min(mask.height-1,Math.floor(m.y)));amount*=coverage[(my*mask.width+mx)*4+3]/255;}const old=result.data[at+channels-1],alpha=amount+old*(1-amount);for(let c=0;c<channels-1;c++)result.data[at+c]=alpha?(source.data[from+c]*amount+result.data[at+c]*old*(1-amount))/alpha:0;result.data[at+channels-1]=alpha;}
  }
  return result;
}
