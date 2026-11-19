const open = () => new Promise((resolve, reject) => {
  const r = indexedDB.open('encomendas', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('orders', { keyPath: 'id' });
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

const run = async (mode, fn) => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('orders', mode);
    const req = fn(tx.objectStore('orders'));
    tx.oncomplete = () => { db.close(); resolve(req.result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
  });
};

export const store = {
  all: () => run('readonly', (s) => s.getAll()),
  get: (id) => run('readonly', (s) => s.get(id)),
  put: (o) => run('readwrite', (s) => s.put(o)),
};
