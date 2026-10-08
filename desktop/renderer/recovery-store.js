export class RecoveryStore {
  async open() {
    if (!this.connection) this.connection = new Promise((resolve, reject) => {
      const request = indexedDB.open('compositor-recovery', 1);
      request.onupgradeneeded = () => { for (const name of ['drafts', 'snapshots']) request.result.createObjectStore(name, { keyPath: 'id' }); };
      request.onerror = () => { this.connection = null; reject(request.error); };
      request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); this.connection = null; }; resolve(db); };
    });
    return this.connection;
  }
  async transaction(mode, action) {
    const db = await this.open();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(['drafts', 'snapshots'], mode); let result;
      transaction.oncomplete = () => resolve(result?.result);
      transaction.onabort = () => reject(transaction.error ?? new Error('Recovery storage is unavailable.'));
      transaction.onerror = () => {};
      try { result = action(transaction.objectStore('drafts'), transaction.objectStore('snapshots')); }
      catch (error) { transaction.abort(); reject(error); }
    });
  }
  list() { return this.transaction('readonly', (drafts) => drafts.getAll()); }
  read(id) { return this.transaction('readonly', (_, snapshots) => snapshots.get(id)); }
  put(record) {
    const { snapshot, pending, journal, ...metadata } = record;
    return this.transaction('readwrite', (drafts, snapshots) => { drafts.put(metadata); return snapshots.put(record); });
  }
  remove(id) { return this.transaction('readwrite', (drafts, snapshots) => { drafts.delete(id); return snapshots.delete(id); }); }
}
