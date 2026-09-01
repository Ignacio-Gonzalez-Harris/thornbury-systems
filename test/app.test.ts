import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { server } from '../src/server.ts';

// Server-level checks for the web UI serving and the invoices index the UI
// relies on. Uses an ephemeral port so a running dev server is unaffected.
const base: Promise<string> = new Promise((resolve) => {
  server.listen(0, () => {
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    resolve(`http://localhost:${address.port}`);
  });
});

after(() => server.close());

test('the web UI is served at /app', async () => {
  const res = await fetch(`${await base}/app`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await res.text(), /Thornbury/);
});

test('static serving rejects path traversal and unknown files', async () => {
  const traversal = await fetch(`${await base}/app/..%2Fpackage.json`);
  assert.equal(traversal.status, 404);
  const missing = await fetch(`${await base}/app/nope.css`);
  assert.equal(missing.status, 404);
});

test('the invoices index carries totals for every invoice', async () => {
  const res = await fetch(`${await base}/invoices`);
  assert.equal(res.status, 200);
  const list = (await res.json()) as Array<{ id: string; net: number; vat: number; total: number; display: string }>;
  assert.ok(list.length >= 4);
  const inv = list.find((i) => i.id === 'INV-9002')!;
  assert.equal(inv.net, 245000);
  assert.equal(inv.vat, 3400);
  assert.equal(inv.total, 248400);
  assert.equal(inv.display, '£2,484.00');
});

test('paying an invoice marks it paid and clears the customer balance, and rejects a repeat', async () => {
  const res = await fetch(`${await base}/invoices/INV-9003/pay`, { method: 'POST' });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { paid: boolean };
  assert.equal(body.paid, true);

  const customerRes = await fetch(`${await base}/customers/C-1003`);
  const customer = (await customerRes.json()) as { outstanding: string };
  assert.equal(customer.outstanding, '£0.00');

  const again = await fetch(`${await base}/invoices/INV-9003/pay`, { method: 'POST' });
  assert.equal(again.status, 409);
  const againBody = (await again.json()) as { error: string };
  assert.equal(againBody.error, 'already paid');
});

test('dispatch/run assigns queued work orders and skips the duplicate-address one', async () => {
  const res = await fetch(`${await base}/dispatch/run`, { method: 'POST' });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { dispatched: number; assignments: unknown[] };
  assert.ok(body.dispatched >= 1);
  assert.ok(Array.isArray(body.assignments));

  const listRes = await fetch(`${await base}/work-orders`);
  const list = (await listRes.json()) as Array<{ id: string; status: string; engineerId?: string }>;
  const w5001 = list.find((w) => w.id === 'W-5001')!;
  const w5002 = list.find((w) => w.id === 'W-5002')!;
  assert.equal(w5001.status, 'DISPATCHED');
  assert.ok(w5001.engineerId);
  assert.equal(w5002.status, 'QUEUED');
});

test('completing a work order sets it DONE and rejects a repeat', async () => {
  const res = await fetch(`${await base}/work-orders/W-5004/complete`, { method: 'POST' });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { status: string };
  assert.equal(body.status, 'DONE');

  const again = await fetch(`${await base}/work-orders/W-5004/complete`, { method: 'POST' });
  assert.equal(again.status, 409);
  const againBody = (await again.json()) as { error: string };
  assert.equal(againBody.error, 'already done');
});

test('creating a work order validates input and appends to the queue', async () => {
  const res = await fetch(`${await base}/work-orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      customerId: 'C-1002',
      requires: 'LEAK',
      requestedAt: '2026-09-03T09:00:00Z',
      durationMinutes: 45,
    }),
  });
  assert.equal(res.status, 201);
  const created = (await res.json()) as { id: string; status: string };
  assert.match(created.id, /^W-\d+$/);
  assert.equal(created.status, 'QUEUED');

  const listRes = await fetch(`${await base}/work-orders`);
  const list = (await listRes.json()) as Array<{ id: string; status: string }>;
  assert.ok(list.some((w) => w.id === created.id && w.status === 'QUEUED'));

  const missingField = await fetch(`${await base}/work-orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ customerId: 'C-1002', requires: 'LEAK', durationMinutes: 45 }),
  });
  assert.equal(missingField.status, 400);

  const unknownCustomer = await fetch(`${await base}/work-orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      customerId: 'C-9999',
      requires: 'LEAK',
      requestedAt: '2026-09-03T09:00:00Z',
      durationMinutes: 45,
    }),
  });
  assert.equal(unknownCustomer.status, 400);

  const badJson = await fetch(`${await base}/work-orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not valid json',
  });
  assert.equal(badJson.status, 400);
});
