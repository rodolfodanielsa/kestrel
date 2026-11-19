import { ESTADOS, DESCONHECIDO, validate, newOrder, touch, filterOrders, sync, parseCatalog } from './core.js';
import { store } from './db.js';

const $ = (id) => document.getElementById(id);
const eur = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' });
const filters = { estado: 'todos', pago: 'todos' };
let editing = null;
const ESTADO_COR = { 'recebida': '#7a8fa6', 'em stock': '#2f7d4f', 'pronta para imprimir': '#f4b942', 'a imprimir': '#b3213b', 'entregue': '#9aa8a1' };

const loadCatalog = () => { try { return JSON.parse(localStorage.getItem('catalogo')) ?? []; } catch { return []; } };
function renderCatalog() {
  const cat = loadCatalog();
  $('catalogo').replaceChildren(...cat.map((c) => new Option(c.nome, c.nome)));
  $('cat-info').textContent = cat.length ? `${cat.length} artigos no catálogo` : 'Sem catálogo';
}
renderCatalog();

function fillPrice() {
  const item = loadCatalog().find((c) => c.nome === $('modelo').value.trim());
  const qty = Number($('quantidade').value);
  if (item && qty >= 1) $('preco').value = +(item.preco * qty).toFixed(2);
}
$('modelo').addEventListener('change', fillPrice);
$('quantidade').addEventListener('change', fillPrice);
$('csv').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  localStorage.setItem('catalogo', JSON.stringify(parseCatalog(await file.text())));
  renderCatalog();
});

for (const e of [...ESTADOS]) {
  for (const sel of [$('f-estado'), $('estado')]) sel.append(new Option(e, e));
}
$('f-estado').append(new Option(DESCONHECIDO, DESCONHECIDO), new Option('arquivadas', 'arquivadas'));

async function render() {
  const orders = filterOrders(await store.all(), filters).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const ul = $('list');
  ul.replaceChildren();
  $('empty').hidden = orders.length > 0;
  for (const o of orders) {
    const li = document.createElement('li');
    const known = ESTADOS.includes(o.estado);
    const title = document.createElement('strong');
    title.textContent = `${o.cliente} — ${o.modelo} ×${o.quantidade}`;
    const meta = document.createElement('div');
    const badge = document.createElement('span');
    badge.className = 'badge' + (known ? '' : ' warn');
    badge.textContent = known ? o.estado : DESCONHECIDO;
    const paid = document.createElement('span');
    paid.className = 'badge ' + (o.pago ? 'ok' : 'warn');
    paid.textContent = o.pago ? 'pago' : 'não pago';
    const price = document.createElement('span');
    price.className = 'price';
    price.textContent = eur.format(o.preco);
    meta.append(badge, paid);
    if (o.dirty) meta.append(Object.assign(document.createElement('span'), { textContent: '⏳', title: 'por sincronizar' }));
    li.style.setProperty('--est', ESTADO_COR[o.estado] ?? '#e0a030');
    li.append(title, price, meta);
    if (o.notas) li.append(Object.assign(document.createElement('small'), { textContent: o.notas }));
    li.addEventListener('click', () => openForm(o));
    ul.append(li);
  }
}

function openForm(o) {
  editing = o;
  $('form-title').textContent = o ? 'Editar encomenda' : 'Nova encomenda';
  $('cliente').value = o?.cliente ?? '';
  $('modelo').value = o?.modelo ?? '';
  $('quantidade').value = o?.quantidade ?? 1;
  $('preco').value = o?.preco ?? '';
  $('estado').value = ESTADOS.includes(o?.estado) ? o.estado : ESTADOS[0];
  $('pago').checked = !!o?.pago;
  $('notas').value = o?.notas ?? '';
  $('errors').textContent = '';
  $('archive').hidden = !o;
  $('archive').textContent = o?.arquivada ? 'Desarquivar' : 'Arquivar';
  $('dlg').showModal();
}

$('order-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const { errors, value } = validate({
    cliente: $('cliente').value, modelo: $('modelo').value, quantidade: $('quantidade').value,
    preco: $('preco').value, estado: $('estado').value, pago: $('pago').checked, notas: $('notas').value,
  });
  if (errors.length) { $('errors').textContent = errors.join(' '); return; }
  await store.put(editing ? touch(editing, value) : newOrder(value));
  $('dlg').close();
  await render();
});

$('archive').addEventListener('click', async () => {
  await store.put(touch(editing, { arquivada: !editing.arquivada }));
  $('dlg').close();
  await render();
});
$('cancel').addEventListener('click', () => $('dlg').close());
$('new').addEventListener('click', () => openForm(null));
$('f-estado').addEventListener('change', (e) => { filters.estado = e.target.value; render(); });
$('f-pago').addEventListener('change', (e) => { filters.pago = e.target.value; render(); });

$('settings-btn').addEventListener('click', () => {
  $('url').value = localStorage.getItem('syncUrl') ?? '';
  $('secret').value = localStorage.getItem('syncSecret') ?? '';
  renderCatalog();
  $('sdlg').showModal();
});
$('settings-form').addEventListener('submit', () => {
  localStorage.setItem('syncUrl', $('url').value.trim());
  localStorage.setItem('syncSecret', $('secret').value);
});

let syncing = false;
async function doSync() {
  if (syncing) return;
  syncing = true;
  $('status').textContent = 'a sincronizar…';
  try {
    await sync(store, (u, o) => fetch(u, o), localStorage.getItem('syncUrl'), localStorage.getItem('syncSecret'));
    $('status').textContent = 'sincronizado ' + new Date().toLocaleTimeString('pt-PT');
  } catch (e) {
    $('status').textContent = 'sync falhou: ' + (e.message || e);
  } finally {
    syncing = false;
    await render();
  }
}
$('sync').addEventListener('click', doSync);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
await render();
if (localStorage.getItem('syncUrl') && navigator.onLine) doSync();
