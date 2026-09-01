import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { server } from '../src/server.ts';
import { format } from '../src/shared/money.ts';

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

test('creating a customer validates input and appends to the list', async () => {
  const res = await fetch(`${await base}/customers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Ada Fenwick',
      address: '3 Cooperage Lane, Thornbury',
      accountType: 'DOMESTIC',
    }),
  });
  assert.equal(res.status, 201);
  const created = (await res.json()) as { id: string; name: string; vatRegistered: boolean };
  assert.match(created.id, /^C-\d+$/);
  assert.equal(created.name, 'Ada Fenwick');
  assert.equal(created.vatRegistered, false);

  const listRes = await fetch(`${await base}/customers`);
  const list = (await listRes.json()) as Array<{ id: string }>;
  assert.ok(list.some((c) => c.id === created.id));

  const badAccountType = await fetch(`${await base}/customers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Bad Type Co', address: 'Somewhere', accountType: 'PERSONAL' }),
  });
  assert.equal(badAccountType.status, 400);

  const emptyName = await fetch(`${await base}/customers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '', address: 'Somewhere', accountType: 'DOMESTIC' }),
  });
  assert.equal(emptyName.status, 400);
});

test('creating an invoice computes totals per the VAT policy and updates outstanding', async () => {
  const customerRes = await fetch(`${await base}/customers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Marlowe Bottling Ltd',
      address: 'Unit 2, Riverside Trade Park, Thornbury',
      accountType: 'COMMERCIAL',
      vatRegistered: true,
    }),
  });
  assert.equal(customerRes.status, 201);
  const customer = (await customerRes.json()) as { id: string };

  const supplyTotal = 10 * 200; // 2000
  const serviceTotal = 2 * 5000; // 10000
  const expectedNet = supplyTotal + serviceTotal;
  const expectedVat = Math.round((serviceTotal * 20) / 100);
  const expectedTotal = expectedNet + expectedVat;

  const res = await fetch(`${await base}/invoices`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      customerId: customer.id,
      lines: [
        { description: 'Metered supply', quantity: 10, unitPence: 200, kind: 'SUPPLY' },
        { description: 'Leak repair', quantity: 2, unitPence: 5000, kind: 'SERVICE' },
      ],
    }),
  });
  assert.equal(res.status, 201);
  const created = (await res.json()) as {
    id: string;
    net: number;
    vat: number;
    total: number;
    display: string;
    paid: boolean;
    source: string;
  };
  assert.match(created.id, /^INV-\d+$/);
  assert.equal(created.net, expectedNet);
  assert.equal(created.vat, expectedVat);
  assert.equal(created.total, expectedTotal);
  assert.equal(created.paid, false);
  assert.equal(created.source, 'WEB');

  const invoicesRes = await fetch(`${await base}/customers/${customer.id}/invoices`);
  const invoicesList = (await invoicesRes.json()) as Array<{ id: string }>;
  assert.ok(invoicesList.some((i) => i.id === created.id));

  const customerAfter = await fetch(`${await base}/customers/${customer.id}`);
  const customerBody = (await customerAfter.json()) as { outstanding: string };
  assert.equal(customerBody.outstanding, format(expectedTotal));

  const emptyLines = await fetch(`${await base}/invoices`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ customerId: customer.id, lines: [] }),
  });
  assert.equal(emptyLines.status, 400);

  const badKind = await fetch(`${await base}/invoices`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      customerId: customer.id,
      lines: [{ description: 'Mystery charge', quantity: 1, unitPence: 100, kind: 'OTHER' }],
    }),
  });
  assert.equal(badKind.status, 400);
});

test('updating a customer applies name/address only and rejects other fields', async () => {
  const createRes = await fetch(`${await base}/customers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Original Name Ltd',
      address: 'Old Address, Thornbury',
      accountType: 'COMMERCIAL',
    }),
  });
  const customer = (await createRes.json()) as { id: string };

  const updateRes = await fetch(`${await base}/customers/${customer.id}/update`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: 'New Address, Thornbury' }),
  });
  assert.equal(updateRes.status, 200);
  const updated = (await updateRes.json()) as { address: string };
  assert.equal(updated.address, 'New Address, Thornbury');

  const getRes = await fetch(`${await base}/customers/${customer.id}`);
  const fetched = (await getRes.json()) as { address: string };
  assert.equal(fetched.address, 'New Address, Thornbury');

  const badField = await fetch(`${await base}/customers/${customer.id}/update`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ vatRegistered: true }),
  });
  assert.equal(badField.status, 400);
  const badFieldBody = (await badField.json()) as { error: string };
  assert.equal(badFieldBody.error, 'only name and address can be updated');

  const unknownId = await fetch(`${await base}/customers/C-9999/update`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: 'Nowhere' }),
  });
  assert.equal(unknownId.status, 404);
});
