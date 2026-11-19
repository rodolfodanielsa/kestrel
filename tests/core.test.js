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
