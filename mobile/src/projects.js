import { encodeProject, decodeProject, base64, unbase64 } from './archive.js';

export class ProjectLibrary {
  constructor(filesystem, directory) { this.fs = filesystem; this.directory = directory; }
  options(path) { return { path, directory: this.directory }; }
  async list() {
    let files;
    try { ({ files } = await this.fs.readdir(this.options('projects'))); }
    catch (error) { if (/not exist|not found|ENOENT/i.test(error.message)) return []; throw error; }
    const projects = new Map();
    for (const file of files) {
      if (!/^[0-9a-f-]+\.json$/i.test(file.name)) continue;
      try {
        const result = await this.fs.readFile({ ...this.options('projects/' + file.name), encoding: 'utf8' });
        const record = JSON.parse(result.data);
        if (!/^[0-9a-f-]+$/i.test(record.id) || !/^projects\/[0-9a-f-]+\.comp\.zip$/i.test(record.path) || !Number.isFinite(record.savedAt) || typeof record.name !== 'string') continue;
        if (!projects.has(record.id) || projects.get(record.id).savedAt < record.savedAt) projects.set(record.id, record);
      } catch { /* An incomplete metadata file never replaces a committed project. */ }
    }
    return [...projects.values()].sort((a, b) => b.savedAt - a.savedAt);
  }
  async read(record) {
    const file = await this.fs.readFile(this.options(record.path));
    return decodeProject(typeof file.data === 'string' ? unbase64(file.data) : new Uint8Array(await file.data.arrayBuffer()));
  }
  async save(snapshot, name, id = crypto.randomUUID()) {
    const revision = crypto.randomUUID(), path = `projects/${revision}.comp.zip`, metadataPath = `projects/${revision}.json`;
    const bytes = encodeProject(snapshot, name), record = { id, name, path, savedAt: Date.now() };
    // Each save commits a new archive before publishing its metadata. Interrupted writes leave the preceding save readable.
    await this.fs.writeFile({ ...this.options(path), data: base64(bytes), recursive: true });
    await this.fs.writeFile({ ...this.options(metadataPath), data: JSON.stringify(record), encoding: 'utf8', recursive: true });
    await this.prune(id, revision).catch(() => {});
    return record;
  }
  async prune(id, keep) {
    const { files } = await this.fs.readdir(this.options('projects')); const older = [];
    for (const file of files) {
      if (!/^[0-9a-f-]+\.json$/i.test(file.name) || file.name === keep + '.json') continue;
      try {
        const result = await this.fs.readFile({ ...this.options('projects/' + file.name), encoding: 'utf8' }), record = JSON.parse(result.data);
        if (record.id === id && /^projects\/[0-9a-f-]+\.comp\.zip$/i.test(record.path)) older.push({ ...record, metadata: 'projects/' + file.name });
      } catch { }
    }
    // Retain one previous complete save for recovery.
    for (const record of older.sort((a, b) => b.savedAt - a.savedAt).slice(1)) {
      await this.fs.deleteFile(this.options(record.metadata)); await this.fs.deleteFile(this.options(record.path));
    }
  }
}
