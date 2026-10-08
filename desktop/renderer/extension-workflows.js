import { library } from './library-store.js';
import { pickFile } from './color-workflows.js';
import { settingsDialog } from './settings-dialog.js';
import { validatePlugin, runImagePlugin } from './plugin-api.js';
import { copySurface } from './raster.js';
import { decodeImage } from './compose.js';
import { mappedSelection, maskedChange } from './raster-space.js';

export function installExtensionWorkflows(editor, api) {
  const previous=editor.advancedCommand;
  editor.advancedCommand=async(command)=>{
    if(command==='install-image-plugin'){
      const file=await pickFile('.json');if(!file)return true;if(file.size>2*1024*1024)throw new Error('The plugin package exceeds the size limit.');
      const plugin=JSON.parse(await file.text()),manifest=validatePlugin(plugin.manifest,plugin.source);await library.put({id:'plugin:'+manifest.id,type:'image-plugin',name:manifest.name},{manifest,source:plugin.source});return true;
    }
    if(command==='run-image-plugin'){
      const layer=editor.active,image=layer&&editor.images.get(layer.id);if(!image||layer.workflow?.channelFile)throw new Error('Select a raster layer for the image plugin.');
      const items=await library.list('image-plugin');if(!items.length)throw new Error('Install an image plugin first.');const options=await settingsDialog('Image plugin',[{key:'name',label:'Plugin',options:items.map((p)=>p.name),default:items[0].name},{key:'settings',label:'Plugin settings',type:'textarea',json:true,default:{}}],{});if(!options)return true;
      const plugin=await library.get(items.find((p)=>p.name===options.name).id);let output;
      await settingsDialog(plugin.manifest.name,[],{},null,{apply:async(_,signal)=>{const canvas=copySurface(image),ctx=canvas.getContext('2d'),pixels=ctx.getImageData(0,0,canvas.width,canvas.height);pixels.data.set(await runImagePlugin(plugin.source,pixels,options.settings,signal));ctx.putImageData(pixels,0,0);output=editor.selection?maskedChange(image,canvas,mappedSelection(editor,layer,canvas.width,canvas.height)):canvas;editor.mutate('Image plugin',()=>{editor.storePixels(layer,output);editor.rasterize(layer);});}});return true;
    }
    if(command==='external-filter-export'){
      const layer=editor.active,image=layer&&editor.images.get(layer.id);if(!image)throw new Error('Select an image layer to send to an external filter.');
      const result=await window.desktop.exportImage(image.toDataURL('image/png'),'png',editor.manifest.resolution??72);if(!result.ok)throw new Error(result.error);editor.externalFilter={layerID:layer.id,revision:editor.history.revision,width:image.width,height:image.height};return true;
    }
    if(command==='external-filter-import'){
      const target=editor.externalFilter,layer=target&&editor.manifest?.layers.find((l)=>l.id===target.layerID);if(!layer||editor.history.revision!==target.revision)throw new Error('Export a layer to the external filter before importing its result, without editing the document meanwhile.');
      const file=await pickFile('.png,image/png');if(!file)return true;const url=URL.createObjectURL(file);try{const image=await decodeImage(url);if(image.naturalWidth!==target.width||image.naturalHeight!==target.height)throw new Error('External filter output dimensions must match the exported layer.');const canvas=copySurface(image),source=editor.images.get(layer.id),output=editor.selection?maskedChange(source,canvas,mappedSelection(editor,layer,canvas.width,canvas.height)):canvas;editor.mutate('External filter',()=>{editor.storePixels(layer,output);editor.rasterize(layer);});editor.externalFilter=null;}finally{URL.revokeObjectURL(url);}return true;
    }
    return previous(command);
  };
}
