import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { server } from '../src/server.ts';
import { customers, invoices } from '../src/db.ts';

let baseUrl: string;

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

test('customer statement combines invoices and account totals', async () => {
  const response = await fetch(`${baseUrl}/customers/C-1002/statement`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    customer: {
      id: 'C-1002',
      name: 'Trelawney Foods Ltd',
      address: 'Unit 6, Severnside Park, Avonmouth',
    },
    invoices: [
      {
        id: 'INV-9002',
        issued: '2026-07-01',
        paid: false,
        net: 245000,
        vat: 49000,
        total: 294000,
      },
    ],
    totals: {
      net: 245000,
      vat: 49000,
      invoiced: 294000,
      paid: 0,
      outstanding: 294000,
    },
  });
});

test('customer statement reports an unknown customer', async () => {
  const response = await fetch(`${baseUrl}/customers/unknown/statement`);

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'no such customer' });
});

test('customer statement rejects non-GET requests', async () => {
  const response = await fetch(`${baseUrl}/customers/C-1002/statement`, {
    method: 'POST',
  });

  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET');
  assert.deepEqual(await response.json(), { error: 'method not allowed' });
});

test('a handler failure returns 500 instead of hanging the response', async () => {
  // Simulate a broken customerId reference: remove the customer an existing
  // invoice points at, without touching the seed data on disk.
  const invoice = invoices.find((i) => i.id === 'INV-9001')!;
  const index = customers.findIndex((c) => c.id === invoice.customerId);
  const [removed] = customers.splice(index, 1);
  try {
    const response = await fetch(`${baseUrl}/invoices/${invoice.id}`, {
      signal: AbortSignal.timeout(2000),
    });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'no such customer for invoice' });
  } finally {
    customers.splice(index, 0, removed);
  }
});
