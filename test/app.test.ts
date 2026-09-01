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
