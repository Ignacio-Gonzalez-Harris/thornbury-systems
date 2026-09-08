import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { server } from '../src/server.ts';
import { storePath } from '../src/store.ts';

let baseUrl: string;

// Captured once, at module load, before a single test has run. The scribble
// guard at the bottom of this file compares against this rather than against
// bare existence — see the comment there for why.
const REPO_STORE = fileURLToPath(new URL('../data/store.json', import.meta.url));
const REPO_STORE_EXISTED_AT_LOAD = existsSync(REPO_STORE);

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

// Every test here shares the in-memory arrays, so each one puts back what it
// created. That is also what keeps the server-assigned ids predictable: with the
// seed data restored, the next customer is always C-1005 and the next engineer
// always E-04.
function send(path: string, method: string, body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// --- customers --------------------------------------------------------------

test('customers: POST creates at the collection width, PATCH merges, DELETE removes', async () => {
  const created = await send('/customers', 'POST', {
    name: 'Halesfield Dairy Ltd',
    address: 'Unit 2, Severnside Park, Avonmouth',
    accountType: 'COMMERCIAL',
    vatRegistered: true,
  });

  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), {
    // Four digits, like C-1001..C-1004. A C-5 here would look like a different system.
    id: 'C-1005',
    name: 'Halesfield Dairy Ltd',
    address: 'Unit 2, Severnside Park, Avonmouth',
    accountType: 'COMMERCIAL',
    vatRegistered: true,
  });

  // PATCH is a partial merge, so the untouched fields must survive it.
  const patched = await send('/customers/C-1005', 'PATCH', { address: '3 Quay Road, Avonmouth' });
  assert.equal(patched.status, 200);
  const row = await patched.json();
  assert.equal(row.address, '3 Quay Road, Avonmouth');
  assert.equal(row.name, 'Halesfield Dairy Ltd');

  const removed = await send('/customers/C-1005', 'DELETE');
  assert.equal(removed.status, 204);
  assert.equal(await removed.text(), '');

  const gone = await fetch(`${baseUrl}/customers/C-1005`);
  assert.equal(gone.status, 404);
});

test('customers: deleting one that still has invoices is a 409, not a cascade', async () => {
  const response = await send('/customers/C-1001', 'DELETE');

  assert.equal(response.status, 409);
  const body = await response.json();
  assert.match(body.error, /invoice/);

  // The refusal must not have half-done the delete.
  const still = await fetch(`${baseUrl}/customers/C-1001`);
  assert.equal(still.status, 200);
});

test('customers: a typo in a field name is a 400, not a silent no-op', async () => {
  const response = await send('/customers', 'POST', {
    name: 'Typo Ltd',
    adress: '1 Misspelt Way, Bristol',
    accountType: 'DOMESTIC',
    vatRegistered: false,
  });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /unknown field/);
});

// --- invoices ---------------------------------------------------------------

test('invoices: GET lists them and POST creates one with the defaults applied', async () => {
  const list = await fetch(`${baseUrl}/invoices`);
  assert.equal(list.status, 200);
  const seeded = await list.json();
  assert.ok(seeded.some((invoice: { id: string }) => invoice.id === 'INV-9001'));

  const created = await send('/invoices', 'POST', {
    customerId: 'C-1003',
    issued: '2026-09-01',
    lines: [{ description: 'Emergency call out', quantity: 1, unitPence: 14000, kind: 'SERVICE' }],
  });

  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), {
    id: 'INV-9005',
    customerId: 'C-1003',
    issued: '2026-09-01',
    lines: [{ description: 'Emergency call out', quantity: 1, unitPence: 14000, kind: 'SERVICE' }],
    source: 'WEB',
    paid: false,
  });

  const removed = await send('/invoices/INV-9005', 'DELETE');
  assert.equal(removed.status, 204);
});

test('invoices: a paid invoice is locked against both PATCH and DELETE', async () => {
  const patched = await send('/invoices/INV-9001', 'PATCH', { paid: false });
  assert.equal(patched.status, 409);
  assert.match((await patched.json()).error, /paid/);

  const removed = await send('/invoices/INV-9004', 'DELETE');
  assert.equal(removed.status, 409);
  assert.match((await removed.json()).error, /paid/);

  // Neither refusal may have changed anything on the way out.
  const invoice = await (await fetch(`${baseUrl}/invoices/INV-9001`)).json();
  assert.equal(invoice.paid, true);
});

test('invoices: a fractional unitPence is rejected — money is integer pence', async () => {
  const response = await send('/invoices', 'POST', {
    customerId: 'C-1001',
    issued: '2026-09-01',
    lines: [{ description: 'Metered supply', quantity: 41, unitPence: 218.5, kind: 'SUPPLY' }],
  });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /whole number/);
});

// --- engineers --------------------------------------------------------------

test('engineers: GET lists them and POST creates one at the two-digit width', async () => {
  const list = await fetch(`${baseUrl}/engineers`);
  assert.equal(list.status, 200);
  assert.deepEqual(
    (await list.json()).map((engineer: { id: string }) => engineer.id),
    ['E-01', 'E-02', 'E-03'],
  );

  const created = await send('/engineers', 'POST', {
    name: 'Sam Okoro',
    skills: ['METER', 'BACKFLOW'],
  });

  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), {
    id: 'E-04',
    name: 'Sam Okoro',
    skills: ['METER', 'BACKFLOW'],
  });

  const removed = await send('/engineers/E-04', 'DELETE');
  assert.equal(removed.status, 204);
  assert.equal(await removed.text(), '');
});

test('engineers: deleting one who is on a work order is a 409', async () => {
  const engineer = await (
    await send('/engineers', 'POST', { name: 'Sam Okoro', skills: ['METER'] })
  ).json();

  const order = await (
    await send('/work-orders', 'POST', {
      customerId: 'C-1001',
      address: '14 Ashfield Row, Bristol',
      requires: 'METER',
      requestedAt: '2026-09-10T09:00:00Z',
      durationMinutes: 60,
      engineerId: engineer.id,
    })
  ).json();

  try {
    const refused = await send(`/engineers/${engineer.id}`, 'DELETE');
    assert.equal(refused.status, 409);
    assert.match((await refused.json()).error, /work order/);
  } finally {
    assert.equal((await send(`/work-orders/${order.id}`, 'DELETE')).status, 204);
    assert.equal((await send(`/engineers/${engineer.id}`, 'DELETE')).status, 204);
  }
});

// --- work orders ------------------------------------------------------------

test('work orders: POST stores requestedAt as canonical UTC and GET/:id reads it back', async () => {
  const created = await send('/work-orders', 'POST', {
    customerId: 'C-1002',
    address: 'Unit 6, Severnside Park, Avonmouth',
    requires: 'BACKFLOW',
    // BST, so this is 08:30 UTC. Stored canonically; only the display layer
    // converts back to Europe/London.
    requestedAt: '2026-09-10T09:30:00+01:00',
    durationMinutes: 45,
  });

  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), {
    id: 'W-5007',
    customerId: 'C-1002',
    address: 'Unit 6, Severnside Park, Avonmouth',
    requires: 'BACKFLOW',
    requestedAt: '2026-09-10T08:30:00.000Z',
    durationMinutes: 45,
    status: 'QUEUED',
  });

  const fetched = await fetch(`${baseUrl}/work-orders/W-5007`);
  assert.equal(fetched.status, 200);
  assert.equal((await fetched.json()).requestedAt, '2026-09-10T08:30:00.000Z');

  const patched = await send('/work-orders/W-5007', 'PATCH', { status: 'DISPATCHED' });
  assert.equal(patched.status, 200);
  assert.equal((await patched.json()).status, 'DISPATCHED');

  const removed = await send('/work-orders/W-5007', 'DELETE');
  assert.equal(removed.status, 204);
  assert.equal((await fetch(`${baseUrl}/work-orders/W-5007`)).status, 404);
});

test('work orders: a requestedAt with no timezone is refused, not guessed at', async () => {
  // This exact ambiguity is what produced W-4412 twice: 23:30 is one calendar
  // day in UTC and the next one in Europe/London.
  const response = await send('/work-orders', 'POST', {
    customerId: 'C-1001',
    address: '14 Ashfield Row, Bristol',
    requires: 'METER',
    requestedAt: '2026-09-02T23:30:00',
    durationMinutes: 60,
  });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /timezone/);

  // And nothing was written on the way to the rejection.
  const orders = await (await fetch(`${baseUrl}/work-orders`)).json();
  assert.equal(orders.length, 6);
});

// --- unknown ids, partial merges and referential integrity -------------------

test('an unknown id is a 404 on every entity, for PATCH and for DELETE alike', async () => {
  // PRD 5.2 names 404 in the status contract, but until this test nothing ever
  // asked for a row that is not there: crud.ts's notFound() helper and the
  // server's error-to-status mapping were both dead to the suite. A reviewer
  // remapped notFound to 409 and everything still passed.
  //
  // PATCH goes through readJson() before the lookup, so these bodies have to
  // parse — the 404 must come from the missing row, not from a missing body.
  const customer = await send('/customers/C-9999', 'PATCH', { name: 'Nobody Ltd' });
  assert.equal(customer.status, 404);
  assert.match((await customer.json()).error, /no such customer/);

  const engineer = await send('/engineers/E-99', 'PATCH', { name: 'Nobody' });
  assert.equal(engineer.status, 404);
  assert.match((await engineer.json()).error, /no such engineer/);

  const invoice = await send('/invoices/INV-9999', 'DELETE');
  assert.equal(invoice.status, 404);
  assert.match((await invoice.json()).error, /no such invoice/);

  const order = await send('/work-orders/W-9999', 'DELETE');
  assert.equal(order.status, 404);
  assert.match((await order.json()).error, /no such work order/);
});

test('invoices: PATCH on an unpaid one merges the sent field and leaves the rest alone', async () => {
  const created = await (
    await send('/invoices', 'POST', {
      customerId: 'C-1003',
      issued: '2026-09-01',
      source: 'BATCH',
      lines: [{ description: 'Leak repair', quantity: 1, unitPence: 12500, kind: 'SERVICE' }],
    })
  ).json();

  try {
    const patched = await send(`/invoices/${created.id}`, 'PATCH', { issued: '2026-09-04' });
    assert.equal(patched.status, 200);
    const row = await patched.json();

    assert.equal(row.issued, '2026-09-04');
    // The second half is the half that matters: PATCH is a partial merge, not a
    // replace. Without these, deleting the whole Object.assign out of
    // updateInvoice leaves the suite green.
    assert.equal(row.customerId, 'C-1003');
    assert.equal(row.source, 'BATCH');
    assert.deepEqual(row.lines, [
      { description: 'Leak repair', quantity: 1, unitPence: 12500, kind: 'SERVICE' },
    ]);
    assert.equal(row.paid, false);
  } finally {
    assert.equal((await send(`/invoices/${created.id}`, 'DELETE')).status, 204);
  }
});

test('engineers: PATCH merges the sent field and leaves the rest alone', async () => {
  const created = await (
    await send('/engineers', 'POST', { name: 'Sam Okoro', skills: ['METER', 'BACKFLOW'] })
  ).json();

  try {
    const patched = await send(`/engineers/${created.id}`, 'PATCH', { name: 'Samuel Okoro' });
    assert.equal(patched.status, 200);
    const row = await patched.json();

    assert.equal(row.name, 'Samuel Okoro');
    // Skills were not sent, so they must survive untouched.
    assert.deepEqual(row.skills, ['METER', 'BACKFLOW']);
    assert.equal(row.id, created.id);
  } finally {
    assert.equal((await send(`/engineers/${created.id}`, 'DELETE')).status, 204);
  }
});

test('a write that would create an orphan is refused at the door', async () => {
  // "No cascading deletes" only holds if the front door refuses to make orphans
  // in the first place. A reviewer neutered requireCustomer, requireEngineer and
  // the issued-date check together and the suite stayed green.
  const orphanInvoice = await send('/invoices', 'POST', {
    customerId: 'C-9999',
    issued: '2026-09-01',
    lines: [{ description: 'Metered supply', quantity: 1, unitPence: 218, kind: 'SUPPLY' }],
  });
  assert.equal(orphanInvoice.status, 400);
  assert.match((await orphanInvoice.json()).error, /no such customer: C-9999/);

  const orphanOrder = await send('/work-orders', 'POST', {
    customerId: 'C-1001',
    address: '14 Ashfield Row, Bristol',
    requires: 'METER',
    requestedAt: '2026-09-10T09:00:00Z',
    durationMinutes: 60,
    engineerId: 'E-99',
  });
  assert.equal(orphanOrder.status, 400);
  assert.match((await orphanOrder.json()).error, /no such engineer: E-99/);

  // UK day-first order. Accepting it would file the invoice under the wrong day
  // in a way nothing downstream could tell from a correct one.
  const wrongOrder = await send('/invoices', 'POST', {
    customerId: 'C-1001',
    issued: '01-07-2026',
    lines: [{ description: 'Metered supply', quantity: 1, unitPence: 218, kind: 'SUPPLY' }],
  });
  assert.equal(wrongOrder.status, 400);
  assert.match((await wrongOrder.json()).error, /YYYY-MM-DD/);

  // None of the three refusals may have written a row on its way out.
  assert.equal(((await (await fetch(`${baseUrl}/invoices`)).json()) as unknown[]).length, 4);
  assert.equal(((await (await fetch(`${baseUrl}/work-orders`)).json()) as unknown[]).length, 6);
});

// --- the HTTP layer itself --------------------------------------------------

test('bodies: empty, unparseable and oversized are all 400', async () => {
  const empty = await send('/customers', 'POST');
  assert.equal(empty.status, 400);
  assert.match((await empty.json()).error, /required/);

  const broken = await fetch(`${baseUrl}/customers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"name": ',
  });
  assert.equal(broken.status, 400);
  assert.match((await broken.json()).error, /valid JSON/);

  const huge = await fetch(`${baseUrl}/customers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: `"${'x'.repeat(1_100_000)}"`,
  });
  assert.equal(huge.status, 400);
  assert.match((await huge.json()).error, /too large/);
});

test('a known path with an unsupported method is a 405 that names the methods', async () => {
  const collection = await send('/customers', 'PUT');
  assert.equal(collection.status, 405);
  assert.equal(collection.headers.get('allow'), 'GET, POST');
  assert.deepEqual(await collection.json(), { error: 'method not allowed' });

  const order = await send('/work-orders/W-5001', 'POST', {});
  assert.equal(order.status, 405);
  assert.equal(order.headers.get('allow'), 'GET, PATCH, DELETE');

  const engineer = await fetch(`${baseUrl}/engineers/E-01`);
  assert.equal(engineer.status, 405);
  assert.equal(engineer.headers.get('allow'), 'PATCH, DELETE');
});

test('an unknown path is still the existing 404', async () => {
  const response = await fetch(`${baseUrl}/nope`);

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'no such route', path: '/nope' });
});

test('the index lists the write routes as well as the read ones', async () => {
  const response = await fetch(`${baseUrl}/`);

  assert.equal(response.status, 200);
  const routes: string[] = (await response.json()).routes;
  for (const route of [
    'POST /customers',
    'DELETE /customers/:id',
    'GET /invoices',
    'GET /engineers',
    'POST /work-orders',
    'GET /work-orders/:id',
  ]) {
    assert.ok(routes.includes(route), `index does not advertise ${route}`);
  }
});

// --- persistence ------------------------------------------------------------

test('a row written by one process is loaded by the next one', () => {
  // db.ts resolves storePath() once, at import time, so a snapshot written here
  // could never be re-loaded here. Two child processes are the only honest test.
  const fixture = fileURLToPath(new URL('./fixtures/store-roundtrip.ts', import.meta.url));
  const storeFile = join(tmpdir(), `thornbury-store-${process.pid}-${Date.now()}.json`);

  const run = (mode: string) =>
    JSON.parse(
      execFileSync(process.execPath, ['--experimental-strip-types', fixture, mode], {
        env: { ...process.env, THORNBURY_STORE: storeFile },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );

  try {
    const written = run('write');
    assert.equal(written.id, 'C-1005');
    assert.equal(written.total, 5);

    const reloaded = run('read');
    assert.equal(reloaded.id, 'C-1005');
    assert.equal(reloaded.total, 5);

    const snapshot = JSON.parse(readFileSync(storeFile, 'utf8'));
    assert.equal(snapshot.customers.length, 5);
    assert.equal(snapshot.engineers.length, 3);
  } finally {
    rmSync(storeFile, { force: true });
    rmSync(`${storeFile}.tmp`, { force: true });
  }
});

test('the test run cannot write a snapshot into the repo', () => {
  // The invariant is that persistence is OFF under the test runner, and the
  // thing that makes it off is storePath() returning null: no THORNBURY_STORE,
  // and argv[1] is this test file rather than server.ts. With that null, db.ts
  // never loads and persist() is a no-op, so a write is impossible.
  assert.equal(storePath(), null);

  // This used to assert that <repo>/data/store.json simply does not exist, which
  // was wrong: `npm start` — the command the README documents — legitimately
  // creates exactly that file, and data/ is gitignored, so after anyone ran the
  // server once the suite went red with a bare `true !== false` and git showed
  // nothing to explain it. That asserts on ambient repo state, not on us. Do not
  // restore it. What we can honestly claim is that THIS run created nothing:
  // compare against what was on disk when this file was imported.
  assert.equal(
    existsSync(REPO_STORE) && !REPO_STORE_EXISTED_AT_LOAD,
    false,
    'this test run created data/store.json',
  );
});
