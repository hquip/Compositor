import xcode from 'xcode';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../ios/App/', import.meta.url);
const project = xcode.project(fileURLToPath(new URL('App.xcodeproj/project.pbxproj', root))); project.parseSync();
const references = Object.values(project.pbxFileReferenceSection()).filter((item) => item && typeof item === 'object');
for (const name of ['PrivacyInfo.xcprivacy', 'CompositorImages.swift', 'CompositorViewController.swift']) {
  if (!references.some((item) => item.path?.replaceAll('"', '') === name)) throw new Error(`Missing iOS project resource: ${name}`);
  await access(new URL('App/' + name, root));
}
const storyboard = await readFile(new URL('App/Base.lproj/Main.storyboard', root), 'utf8');
if (!storyboard.includes('customClass="CompositorViewController"')) throw new Error('The iOS native decoder is not registered.');
console.log('iOS project references and native plugin wiring verified. Xcode compilation still requires macOS.');
