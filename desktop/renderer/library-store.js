export class LibraryStore {
  async open() {
    if (!this.connection) this.connection = new Promise((resolve, reject) => {
      const request = indexedDB.open('compositor-library', 1);
      request.onupgradeneeded = () => { request.result.createObjectStore('metadata', { keyPath: 'id' }); request.result.createObjectStore('payloads', { keyPath: 'id' }); };
      request.onerror = () => { this.connection = null; reject(request.error); }; request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); this.connection = null; }; resolve(db); };
    }); return this.connection;
  }
  async transaction(mode, action) {
    const db = await this.open(); return new Promise((resolve, reject) => { const transaction = db.transaction(['metadata', 'payloads'], mode); let request;
      transaction.oncomplete = () => resolve(request?.result); transaction.onabort = () => reject(transaction.error ?? new Error('Could not update the local library.')); transaction.onerror = () => {};
      try { request = action(transaction.objectStore('metadata'), transaction.objectStore('payloads')); } catch (error) { transaction.abort(); reject(error); }
    });
  }
  async list(type) { return (await this.transaction('readonly', (metadata) => metadata.getAll())).filter((item) => !type || item.type === type).sort((a, b) => b.updated - a.updated); }
  async get(id) { return (await this.transaction('readonly', (_, payloads) => payloads.get(id)))?.value; }
  put(metadata, value) { return this.transaction('readwrite', (entries, payloads) => { entries.put({ ...metadata, updated: Date.now() }); return payloads.put({ id: metadata.id, value }); }); }
  remove(id) { return this.transaction('readwrite', (entries, payloads) => { entries.delete(id); return payloads.delete(id); }); }
}
export const library = new LibraryStore();
