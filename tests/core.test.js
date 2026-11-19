import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, filterOrders, merge, sync, ESTADOS } from '../core.js';
import { memStore, mockAppsScript, order } from './helpers.js';

const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';
const good = { cliente: 'Ana', modelo: 'Vaso', quantidade: '2', preco: '12,50', estado: 'recebida', pago: false, notas: '' };

test('validate: required fields and numeric checks', () => {
  assert.equal(validate(good).errors.length, 0);
  assert.equal(validate(good).value.preco, 12.5);
  assert.equal(validate({ ...good, cliente: '  ' }).errors.length, 1);
  assert.equal(validate({ ...good, preco: 'abc' }).errors.length, 1);
  assert.equal(validate({ ...good, quantidade: '1.5' }).errors.length, 1);
  assert.equal(validate({ ...good, quantidade: 'x' }).errors.length, 1);
  assert.equal(validate({ ...good, preco: '' }).errors.length, 1);
  assert.equal(validate({ ...good, estado: 'foo' }).errors.length, 1);
});

test('filter: each estado, pago, arquivadas, desconhecido', () => {
  const os = ESTADOS.map((e, i) => order('id' + i, { estado: e, pago: i % 2 === 0 }));
  os.push(order('arq', { arquivada: true, pago: true }), order('odd', { estado: 'xpto' }));
  ESTADOS.forEach((e, i) => assert.deepEqual(filterOrders(os, { estado: e }).map((o) => o.id), ['id' + i]));
  assert.equal(filterOrders(os).length, 6);
  assert.deepEqual(filterOrders(os, { pago: 'pago' }).map((o) => o.id), ['id0', 'id2', 'id4']);
  assert.equal(filterOrders(os, { pago: 'nao' }).length, 3);
  assert.deepEqual(filterOrders(os, { estado: 'arquivadas' }).map((o) => o.id), ['arq']);
  assert.deepEqual(filterOrders(os, { estado: 'estado desconhecido' }).map((o) => o.id), ['odd']);
});

test('merge: last updated_at wins', () => {
  const a = order(U1, { updated_at: '2026-01-01T10:00:00.000Z', dirty: true });
  const b = order(U1, { updated_at: '2026-01-01T11:00:00.000Z', cliente: 'Bia' });
  assert.equal(merge(a, b).cliente, 'Bia');
  assert.equal(merge(b, { ...a }).cliente, 'Bia');
  assert.equal(merge(undefined, a).id, U1);
});

test('sync: offline create reaches the sheet, sheet edit reaches the app', async () => {
  const srv = mockAppsScript();
  const store = memStore([order(U1, { dirty: true })]);
  await sync(store, srv.fetch, 'u', 's3cret');
  assert.equal(srv.data.length, 2);
  assert.equal(srv.data[1][0], U1);
  assert.equal(store.m.get(U1).dirty, false);
  srv.data[1][1] = 'Editado no Sheet';
  srv.data[1][9] = '2026-02-01T00:00:00.000Z';
  await sync(store, srv.fetch, 'u', 's3cret');
  assert.equal(store.m.get(U1).cliente, 'Editado no Sheet');
});

test('conflict: sheet newer wins; app newer wins', async () => {
  const srv = mockAppsScript();
  const store = memStore([order(U1, { dirty: true })]);
  await sync(store, srv.fetch, 'u', 's3cret');

  srv.data[1][1] = 'Sheet';
  srv.data[1][9] = '2026-03-02T00:00:00.000Z';
  store.m.set(U1, order(U1, { cliente: 'App', updated_at: '2026-03-01T00:00:00.000Z', dirty: true }));
  await sync(store, srv.fetch, 'u', 's3cret');
  assert.equal(store.m.get(U1).cliente, 'Sheet');
  assert.equal(srv.data[1][1], 'Sheet');

  srv.data[1][9] = '2026-04-01T00:00:00.000Z';
  store.m.set(U1, order(U1, { cliente: 'App2', updated_at: '2026-04-02T00:00:00.000Z', dirty: true }));
  await sync(store, srv.fetch, 'u', 's3cret');
  assert.equal(srv.data[1][1], 'App2');
  assert.equal(store.m.get(U1).cliente, 'App2');
});

test('sync failure keeps pending; retry does not duplicate', async () => {
  const srv = mockAppsScript();
  const store = memStore([order(U1, { dirty: true }), order(U2, { dirty: true })]);
  await assert.rejects(sync(store, srv.failingFetch, 'u', 's3cret'));
  assert.equal(store.m.get(U1).dirty, true);
  await sync(store, srv.fetch, 'u', 's3cret');
  await sync(store, srv.fetch, 'u', 's3cret');
  assert.equal(srv.data.length, 3);
});

test('wrong secret: refused, data kept dirty, nothing returned', async () => {
  const srv = mockAppsScript();
  const store = memStore([order(U1, { dirty: true })]);
  await assert.rejects(sync(store, srv.fetch, 'u', 'wrong'));
  assert.equal(store.m.get(U1).dirty, true);
  assert.equal(srv.data.length, 1);
  const r = srv.call(JSON.stringify({ orders: [] }));
  assert.equal(r.ok, false);
  assert.equal(r.orders, undefined);
});

test('server skips invalid ids, tolerates unknown estado', async () => {
  const srv = mockAppsScript();
  const r = srv.call(JSON.stringify({ secret: 's3cret', orders: [order('bad'), order(U1, { estado: 'zzz' })] }));
  assert.equal(r.orders.length, 1);
  assert.equal(r.orders[0].estado, 'zzz');
});

test('formula-like text: text columns formatted as plain text before every write, round-trips exactly', () => {
  const bad = ['=1+1', '@SUM(1)', '-1+1', '+2', "'=x"];
  const sheet = mockAppsScript();
  const mk = (suffix) => bad.map((c, i) =>
    order(`0000000${i}-0000-0000-0000-000000000000`, { cliente: c, modelo: c, notas: c, estado: c, updated_at: suffix }));
  const textCols = [1, 2, 3, 6, 8, 10];
  const assertFormattedBefore = (kind, row) => {
    const w = sheet.log.findIndex(([k, r]) => k === kind && r === row);
    assert.ok(w >= 0);
    const cols = sheet.log.slice(0, w).filter(([k, r, f]) => k === 'fmt' && r === row && f === '@').map((e) => e[3]);
    textCols.forEach((c) => assert.ok(cols.includes(c)));
  };

  let res = sheet.call(JSON.stringify({ secret: 's3cret', orders: mk('2026-01-01T00:00:00.000Z') }));
  assert.equal(sheet.data.length, bad.length + 1);
  sheet.data.slice(1).forEach((r, i) => [r[1], r[2], r[5], r[7]].forEach((v) => assert.equal(v, bad[i])));
  assert.deepEqual(res.orders.map((o) => o.cliente), bad);
  assert.deepEqual(res.orders.map((o) => o.notas), bad);
  assert.deepEqual(res.orders.map((o) => o.estado), bad);
  for (let row = 2; row <= bad.length + 1; row++) assertFormattedBefore('append', row);

  sheet.log.length = 0;
  res = sheet.call(JSON.stringify({ secret: 's3cret', orders: mk('2026-02-01T00:00:00.000Z') }));
  for (let row = 2; row <= bad.length + 1; row++) assertFormattedBefore('set', row);
  assert.deepEqual(res.orders.map((o) => o.modelo), bad);
});

test('non-ISO updated_at (formula payload) is skipped and never written', () => {
  const srv = mockAppsScript();
  const evil = '+HYPERLINK("http://e","x")&" 1 Jan 2020"';
  const r = srv.call(JSON.stringify({ secret: 's3cret', orders: [order(U1, { updated_at: evil }), order(U1, { updated_at: '2026-01-01' })] }));
  assert.equal(r.orders.length, 0);
  assert.equal(srv.data.length, 1);
  assert.ok(!srv.log.some(([k]) => k === 'append' || k === 'set'));
});

test('null body gets the clean refusal', () => {
  assert.deepEqual(mockAppsScript().call('null'), { ok: false, error: 'não autorizado' });
});

import { totalEmDivida } from '../core.js';
test('totalEmDivida soma só não pagas e não arquivadas', () => {
  const o = (preco, pago, arquivada = false) => ({ preco, pago, arquivada });
  assert.equal(totalEmDivida([o(10, false), o(5.5, false), o(7, true), o(9, false, true)]), 15.5);
  assert.equal(totalEmDivida([]), 0);
});

import { sortOrders } from '../core.js';
test('sortOrders ordena por cliente, estado e agrupa por cliente', () => {
  const o = (cliente, estado, updated_at) => ({ cliente, estado, modelo: 'x', updated_at });
  const l = [o('Zé', 'entregue', '1'), o('ana', 'recebida', '3'), o('Zé', 'recebida', '2'), o('Bia', '???', '4')];
  assert.deepEqual(sortOrders(l, 'cliente').map((x) => x.cliente), ['ana', 'Bia', 'Zé', 'Zé']);
  assert.deepEqual(sortOrders(l, 'estado').map((x) => x.estado), ['recebida', 'recebida', 'entregue', '???']);
  assert.deepEqual(sortOrders(l, 'recentes', true).map((x) => x.updated_at), ['3', '4', '2', '1']);
});

test('sync devolve o catálogo da folha produtos', async () => {
  const srv = mockAppsScript();
  srv.produtos.push(['Cão', 25], ['Gato', '3,5'], ['Sem preço', ''], ['', 4]);
  assert.deepEqual(await sync(memStore(), srv.fetch, 'u', 's3cret'), [{ nome: 'Cão', preco: 25, stock: null, reserva: null }, { nome: 'Gato', preco: 3.5, stock: null, reserva: null }]);
});

test('stock: reserva em "em stock", baixa ao pagar, repõe ao despagar, sem duplicar', async () => {
  const srv = mockAppsScript();
  srv.produtos[0].push('IVA', 'Tipo', 'Motivo', 'Stock');
  srv.produtos.push(['Cão', 25, 0, 'P', '', 5], ['Gato', 3, 0, 'P', '', '']);
  const store = memStore([order('11111111-1111-1111-1111-111111111111', { modelo: 'cão', quantidade: 2, estado: 'em stock', dirty: true })]);
  const col = () => ({ stock: srv.produtos[1][5], reserva: srv.produtos[1][6] });
  const put = async (changes, t) => { const o = await store.get('11111111-1111-1111-1111-111111111111'); await store.put({ ...o, ...changes, updated_at: t, dirty: true }); await sync(store, srv.fetch, 'u', 's3cret'); };
  await sync(store, srv.fetch, 'u', 's3cret');
  assert.deepEqual(col(), { stock: 5, reserva: 2 });
  await put({ pago: true }, '2026-01-02T10:00:00.000Z');
  assert.deepEqual(col(), { stock: 3, reserva: 0 });
  await put({ notas: 'x' }, '2026-01-03T10:00:00.000Z');
  assert.deepEqual(col(), { stock: 3, reserva: 0 });
  await put({ pago: false }, '2026-01-04T10:00:00.000Z');
  assert.deepEqual(col(), { stock: 5, reserva: 2 });
  await put({ modelo: 'Gato' }, '2026-01-05T10:00:00.000Z');
  assert.deepEqual(col(), { stock: 5, reserva: 0 });
  const cat = await sync(store, srv.fetch, 'u', 's3cret');
  assert.deepEqual(cat[0], { nome: 'Cão', preco: 25, stock: 5, reserva: 0 });
});
