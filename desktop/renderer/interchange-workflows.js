import { pickFile } from './color-workflows.js';
import { encodeOpenRaster, decodeOpenRaster } from './openraster.js';
import { binaryBase64 } from './psd-export.js';

export function installInterchangeWorkflows(editor, api) {
  const previous=editor.advancedCommand;
  editor.advancedCommand=async(command)=>{
    if(command==='import-ora'){const file=await pickFile('.ora');if(!file)return true;if(file.size>128*1024*1024)throw new Error('The OpenRaster file exceeds the size limit.');const snapshot=await decodeOpenRaster(new Uint8Array(await file.arrayBuffer()),editor.pixelBudget);await editor.workspace.open({snapshot,name:file.name.replace(/\.ora$/i,''),path:'import:'+crypto.randomUUID()});editor.name=file.name.replace(/\.ora$/i,'');editor.history.savedRevision=null;editor.fit();editor.update();return true;}
    if(command==='export-ora'){if(!editor.manifest)return true;const bytes=encodeOpenRaster(editor),result=await window.desktop.exportFile(binaryBase64(bytes),'ora',editor.name);if(!result.ok)throw new Error(result.error);return true;}
    return previous(command);
  };
}
