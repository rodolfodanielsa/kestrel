import { ESTADOS, DESCONHECIDO, validate, newOrder, touch, filterOrders, sync } from './core.js';
import { store } from './db.js';

const $ = (id) => document.getElementById(id);
const eur = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' });
const filters = { estado: 'todos', pago: 'todos' };
let editing = null;

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
    price.textContent = eur.format(o.preco);
    meta.append(badge, paid, price);
    if (o.dirty) meta.append(Object.assign(document.createElement('span'), { textContent: '⏳', title: 'por sincronizar' }));
    li.append(title, meta);
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
    $('status').textContent = 'sync falhou';
  } finally {
    syncing = false;
    await render();
  }
}
$('sync').addEventListener('click', doSync);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
await render();
if (localStorage.getItem('syncUrl') && navigator.onLine) doSync();
