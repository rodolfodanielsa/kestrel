const SHEET = 'encomendas';
const COLS = ['id', 'cliente', 'modelo', 'quantidade', 'preco', 'estado', 'pago', 'notas', 'arquivada', 'updated_at'];
const TEXT_COLS = ['id', 'cliente', 'modelo', 'estado', 'notas', 'updated_at'];
const APPLIED_COL = COLS.length + 1;

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHEET);
    sh.appendRow(COLS.concat(['stock_aplicado']));
    // Plain text so Sheets never reinterprets ISO timestamps or ids as dates/numbers.
    TEXT_COLS.forEach((c) => sh.getRange(1, COLS.indexOf(c) + 1, sh.getMaxRows(), 1).setNumberFormat('@'));
  }
  return sh;
}

const bool_ = (v) => v === true || String(v).toLowerCase() === 'true';
const ts_ = (v) => (v instanceof Date ? v.toISOString() : String(v));
const str_ = (v, max) => String(v == null ? '' : v).slice(0, max);
// Plain-text format makes Sheets store these as literal text, never formulas.
const fmtText_ = (sh, row) => TEXT_COLS.forEach((c) => sh.getRange(row, COLS.indexOf(c) + 1).setNumberFormat('@'));

function fromRow_(r) {
  return {
    id: String(r[0]), cliente: String(r[1]), modelo: String(r[2]),
    quantidade: Number(r[3]), preco: Number(r[4]), estado: String(r[5]),
    pago: bool_(r[6]), notas: String(r[7]), arquivada: bool_(r[8]), updated_at: ts_(r[9]),
  };
}

function toRow_(o) {
  return [
    str_(o.id, 64), str_(o.cliente, 200), str_(o.modelo, 200),
    Number(o.quantidade), Number(o.preco), str_(o.estado, 50),
    bool_(o.pago), str_(o.notas, 2000), bool_(o.arquivada), ts_(o.updated_at),
  ];
}

const valid_ = (o) => o && typeof o.id === 'string' && /^[0-9a-f-]{36}$/i.test(o.id) &&
  Number.isFinite(Number(o.quantidade)) && Number.isFinite(Number(o.preco)) &&
  typeof o.updated_at === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(o.updated_at) && !isNaN(Date.parse(o.updated_at));

function produtos_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName('produtos') || ss.getSheetByName('Produtos');
}

function stockCols_(sh) {
  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map((x) => String(x).trim().toLowerCase());
  return { stock: h.indexOf('stock') + 1, reserva: h.indexOf('reserva') + 1 };
}

function catalogo_() {
  const sh = produtos_();
  if (!sh || sh.getLastRow() < 2) return [];
  const { stock, reserva } = stockCols_(sh);
  const n = Math.max(2, stock, reserva);
  const cell = (r, c) => (c && String(r[c - 1]).trim() !== '' ? Number(r[c - 1]) : null);
  return sh.getRange(2, 1, sh.getLastRow() - 1, n).getValues()
    .map((r) => ({ nome: String(r[0]).trim(), preco: String(r[1]).trim() === '' ? NaN : Number(String(r[1]).replace(',', '.')), stock: cell(r, stock), reserva: cell(r, reserva) }))
    .filter((c) => c.nome && Number.isFinite(c.preco));
}

// Only products with a number in Stock are tracked; Reserva is created next to it on first use.
function track_(modelo) {
  const sh = produtos_();
  if (!sh || sh.getLastRow() < 2) return null;
  const cols = stockCols_(sh);
  if (!cols.stock) return null;
  const names = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  const idx = names.findIndex((r) => String(r[0]).trim().toLowerCase() === String(modelo).trim().toLowerCase());
  if (idx < 0 || String(sh.getRange(idx + 2, cols.stock).getValue()).trim() === '') return null;
  if (!cols.reserva) {
    cols.reserva = sh.getLastColumn() + 1;
    sh.getRange(1, cols.reserva).setValue('Reserva');
  }
  return { sh, row: idx + 2, cols };
}

const cellNum_ = (t, c) => Number(t.sh.getRange(t.row, c).getValue() || 0);

function bump_(t, dRes, dStock) {
  if (dStock) t.sh.getRange(t.row, t.cols.stock).setValue(cellNum_(t, t.cols.stock) + dStock);
  if (dRes) t.sh.getRange(t.row, t.cols.reserva).setValue(Math.max(0, cellNum_(t, t.cols.reserva) + dRes));
}

// Releases what the order held before, then takes what is free now: unpaid orders reserve, paid ones deduct.
// Whatever is not in stock is simply not reserved (made to order).
function applyStock_(prev, o) {
  const next = { m: o.modelo, r: 0, b: 0 };
  const old = track_(prev.m);
  if (old) bump_(old, -prev.r, prev.b);
  const cur = track_(o.modelo);
  if (cur && (o.pago || !o.arquivada)) {
    const free = Math.max(0, cellNum_(cur, cur.cols.stock) - cellNum_(cur, cur.cols.reserva));
    const take = Math.min(o.quantidade, free);
    if (o.pago) { bump_(cur, 0, -take); next.b = take; } else { bump_(cur, take, 0); next.r = take; }
  }
  return next;
}

function parseApplied_(v) {
  try { const a = JSON.parse(v); return a && typeof a.m === 'string' ? a : null; } catch (err) { return null; }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let req;
    try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'pedido inválido' }); }
    const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
    if (!secret || !req || req.secret !== secret) return json_({ ok: false, error: 'não autorizado' });

    const sh = sheet_();
    const last = sh.getLastRow();
    const rows = last > 1 ? sh.getRange(2, 1, last - 1, APPLIED_COL).getValues() : [];
    const byId = {};
    rows.forEach((r, i) => { byId[String(r[0])] = i; });

    for (const o of Array.isArray(req.orders) ? req.orders : []) {
      if (!valid_(o)) continue;
      const row = toRow_(o);
      const i = byId[row[0]];
      const prev = i === undefined ? { m: row[2], r: 0, b: 0 } : parseApplied_(rows[i][APPLIED_COL - 1]) || { m: String(rows[i][2]), r: 0, b: 0 };
      if (i === undefined) {
        const full = row.concat([JSON.stringify(applyStock_(prev, fromRow_(row)))]);
        rows.push(full);
        byId[row[0]] = rows.length - 1;
        fmtText_(sh, sh.getLastRow() + 1);
        sh.appendRow(full);
      } else if (ts_(rows[i][9]) < row[9]) {
        const full = row.concat([JSON.stringify(applyStock_(prev, fromRow_(row)))]);
        rows[i] = full;
        fmtText_(sh, i + 2);
        sh.getRange(i + 2, 1, 1, APPLIED_COL).setValues([full]);
      }
    }
    return json_({ ok: true, orders: rows.filter((r) => r[0] !== '').map(fromRow_), catalogo: catalogo_() });
  } finally {
    lock.releaseLock();
  }
}

// Hand edits in the Sheet bump updated_at so they win conflicts against older app changes.
function onEdit(e) {
  const r = e.range;
  const sh = r.getSheet();
  if (sh.getName() !== SHEET || r.getRow() < 2) return;
  const tsCol = COLS.indexOf('updated_at') + 1;
  if (r.getColumn() <= tsCol && r.getLastColumn() >= tsCol && r.getNumColumns() === 1) return;
  const now = new Date().toISOString();
  for (let row = r.getRow(); row <= r.getLastRow(); row++) sh.getRange(row, tsCol).setValue(now);
}
