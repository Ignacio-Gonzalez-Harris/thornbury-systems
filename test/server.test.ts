import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { server } from '../src/server.ts';
import { customers, invoices, workOrders } from '../src/db.ts';

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

test('GET /dispatch sends no second van to an address already being visited', async () => {
  // JOB B, pinned at its only production call site. The three regression tests in
  // test/scheduling.test.ts call dispatch() with hand-built arrays, so nothing
  // asserted what src/server.ts actually passes it: dispatch() builds its
  // "already visiting" list from the orders whose status is NOT 'QUEUED', so a
  // caller that pre-filtered to QUEUED would restore the original duplicate-van
  // bug with the whole suite still green.
  //
  // Mrs Whitcombe, exactly as Marcus reports it: a meter job already DISPATCHED
  // to E-01 at 08:00, and a leak job still QUEUED at 08:30 at the same house with
  // no punctuation trickery at all. Same mutate-and-restore idiom as the 500 test
  // above — the seed arrays are shared with every other test in this file.
  const dispatched = workOrders.find((order) => order.id === 'W-5001')!;
  const queued = workOrders.find((order) => order.id === 'W-5002')!;
  const before = {
    status: dispatched.status,
    engineerId: dispatched.engineerId,
    address: queued.address,
  };

  dispatched.status = 'DISPATCHED';
  dispatched.engineerId = 'E-01';
  queued.address = dispatched.address;

  try {
    const response = await fetch(`${baseUrl}/dispatch`);
    assert.equal(response.status, 200);
    const planned: { workOrderId: string; engineerId: string; address: string }[] =
      await response.json();

    assert.deepEqual(
      planned.filter((assignment) => assignment.address === dispatched.address),
      [],
      'a second van was planned for an address already being visited',
    );
    // The bug double-booked the engineer as well as the customer, so name that too.
    assert.equal(planned.some((assignment) => assignment.workOrderId === 'W-5002'), false);

    // And the guard must not have swallowed the rest of the day: an unrelated
    // address still gets planned, so a route that returned [] would fail here.
    assert.equal(planned.some((assignment) => assignment.workOrderId === 'W-5004'), true);
  } finally {
    dispatched.status = before.status;
    if (before.engineerId === undefined) delete dispatched.engineerId;
    else dispatched.engineerId = before.engineerId;
    queued.address = before.address;
  }
});
