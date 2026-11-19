export const ESTADOS = ['recebida', 'em stock', 'pronta para imprimir', 'a imprimir', 'entregue'];
export const DESCONHECIDO = 'estado desconhecido';

export function validate(f) {
  const errors = [];
  const cliente = String(f.cliente ?? '').trim();
  const modelo = String(f.modelo ?? '').trim();
  if (!cliente) errors.push('Cliente é obrigatório.');
  if (!modelo) errors.push('Modelo é obrigatório.');
  const quantidade = Number(String(f.quantidade).replace(',', '.'));
  const preco = Number(String(f.preco).replace(',', '.'));
  if (String(f.quantidade).trim() === '' || !Number.isInteger(quantidade) || quantidade < 1) errors.push('Quantidade tem de ser um inteiro ≥ 1.');
  if (String(f.preco).trim() === '' || !Number.isFinite(preco) || preco < 0) errors.push('Preço tem de ser um número ≥ 0.');
  if (!ESTADOS.includes(f.estado)) errors.push('Estado inválido.');
  return {
    errors,
    value: { cliente, modelo, quantidade, preco, estado: f.estado, pago: !!f.pago, notas: String(f.notas ?? '').trim() },
  };
}

export function newOrder(value, now = new Date()) {
  return { id: crypto.randomUUID(), ...value, arquivada: false, updated_at: now.toISOString(), dirty: true };
}

export function touch(order, changes, now = new Date()) {
  return { ...order, ...changes, updated_at: now.toISOString(), dirty: true };
}

export function filterOrders(orders, { estado = 'todos', pago = 'todos' } = {}) {
  return orders.filter((o) => {
    if (estado === 'arquivadas') return o.arquivada && matchPago(o, pago);
    if (o.arquivada) return false;
    if (estado === DESCONHECIDO) { if (ESTADOS.includes(o.estado)) return false; }
    else if (estado !== 'todos' && o.estado !== estado) return false;
    return matchPago(o, pago);
  });
}

const matchPago = (o, pago) => pago === 'todos' || (pago === 'pago') === !!o.pago;

export function merge(local, remote) {
  if (!local || remote.updated_at > local.updated_at) return { ...remote, dirty: false };
  if (remote.updated_at === local.updated_at) return { ...local, dirty: false };
  return local;
}

const wire = ({ dirty, ...o }) => o;

// Throws on failure; pending orders stay dirty so the next sync resends them (server upsert is idempotent by id).
export async function sync(store, fetchFn, url, secret) {
  if (!url || !secret) throw new Error('Configura o URL e o segredo nas definições.');
  const sent = (await store.all()).filter((o) => o.dirty);
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ secret, orders: sent.map(wire) }),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (!data.ok || !Array.isArray(data.orders)) throw new Error(data.error || 'resposta inválida');
  for (const remote of data.orders) {
    const local = await store.get(remote.id);
    const next = merge(local, remote);
    if (next !== local) await store.put(next);
  }
  for (const s of sent) {
    const local = await store.get(s.id);
    if (local && local.dirty && local.updated_at === s.updated_at) await store.put({ ...local, dirty: false });
  }
}

// Description may contain commas, so only the 4 trailing columns are split off.
export function parseCatalog(text) {
  return text.replace(/^\uFEFF/, '').split(/\r?\n/).slice(1).flatMap((line) => {
    const parts = line.split(',');
    if (parts.length < 5) return [];
    const preco = Number(parts[parts.length - 4]);
    const nome = parts.slice(0, -4).join(',').trim();
    return nome && Number.isFinite(preco) ? [{ nome, preco }] : [];
  });
}
