import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export const memStore = (init = []) => {
  const m = new Map(init.map((o) => [o.id, o]));
  return { all: async () => [...m.values()], get: async (id) => m.get(id), put: async (o) => { m.set(o.id, o); }, m };
};

// Runs the real Code.gs against an in-memory sheet; fetch() mock routes to doPost.
export function mockAppsScript(secret = 's3cret') {
  const data = [['id']];
  const sheet = {
    getName: () => 'encomendas',
    getLastRow: () => data.length,
    getRange: (r, c, n = 1, k = 1) => ({
      getValues: () => data.slice(r - 1, r - 1 + n).map((x) => x.slice(c - 1, c - 1 + k)),
      setValues: (v) => { data[r - 1] = v[0]; },
      setValue: (v) => { data[r - 1][c - 1] = v; },
      setNumberFormat: () => {},
    }),
    appendRow: (row) => data.push(row),
    getMaxRows: () => 1000,
  };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => secret }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ t, setMimeType() { return this; } }) },
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'), ctx);
  const call = (body) => JSON.parse(ctx.doPost({ postData: { contents: body } }).t);
  return {
    data, call,
    fetch: async (_url, o) => ({ ok: true, json: async () => call(o.body) }),
    failingFetch: async () => { throw new Error('offline'); },
  };
}

export const order = (id, over = {}) => ({
  id, cliente: 'Ana', modelo: 'Vaso', quantidade: 1, preco: 10, estado: 'recebida',
  pago: false, notas: '', arquivada: false, updated_at: '2026-01-01T10:00:00.000Z', ...over,
});
