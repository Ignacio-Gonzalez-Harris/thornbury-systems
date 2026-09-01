import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statementFor } from '../src/invoices/statement.ts';
import { customers, invoices, type Customer, type Invoice } from '../src/db.ts';

test('statement for a commercial customer has one line per invoice with VAT-inclusive totals', () => {
  // INV-9002: 1120*195 + 9600 + 2*8500 = 245000 net; VAT is 20% of the SERVICE
  // subtotal (2*8500 = 17000) = 3400; total = 248400. Unpaid, so it is also
  // the whole outstanding balance.
  const customer = customers.find((c) => c.id === 'C-1002')!;
  const statement = statementFor(customer, invoices);

  assert.equal(statement.customerId, 'C-1002');
  assert.equal(statement.lines.length, 1);
  const [line] = statement.lines;
  assert.equal(line.invoiceId, 'INV-9002');
  assert.equal(line.net, 245000);
  assert.equal(line.vat, 3400);
  assert.equal(line.total, 248400);
  assert.equal(line.paid, false);

  assert.equal(statement.totals.outstanding, 248400);
  assert.equal(statement.display.outstanding, '£2,484.00');
});

test('a paid invoice does not count toward the outstanding balance', () => {
  // C-1001's only invoice, INV-9001, is paid.
  const customer = customers.find((c) => c.id === 'C-1001')!;
  const statement = statementFor(customer, invoices);

  assert.equal(statement.lines.length, 1);
  assert.equal(statement.lines[0].paid, true);
  assert.equal(statement.totals.outstanding, 0);
});

test('statement lines are sorted by issued date ascending', () => {
  // The seed data only gives each customer a single invoice, so build a
  // two-invoice fixture here, deliberately out of order, to check sorting.
  const customer: Customer = customers.find((c) => c.id === 'C-1002')!;
  const later: Invoice = {
    id: 'INV-9010',
    customerId: 'C-1002',
    issued: '2026-08-01',
    source: 'BATCH',
    paid: false,
    lines: [{ description: 'Metered supply, Q3', quantity: 100, unitPence: 195, kind: 'SUPPLY' }],
  };
  const earlier: Invoice = {
    id: 'INV-9009',
    customerId: 'C-1002',
    issued: '2026-06-01',
    source: 'BATCH',
    paid: false,
    lines: [{ description: 'Metered supply, Q1 top-up', quantity: 50, unitPence: 195, kind: 'SUPPLY' }],
  };
  // Passed in out of order (later before earlier) to prove statementFor sorts.
  const statement = statementFor(customer, [later, earlier]);

  assert.deepEqual(
    statement.lines.map((l) => l.invoiceId),
    ['INV-9009', 'INV-9010'],
  );
  assert.deepEqual(
    statement.lines.map((l) => l.issued),
    ['2026-06-01', '2026-08-01'],
  );
});

test('statement totals equal the sum of its own lines', () => {
  const customer: Customer = customers.find((c) => c.id === 'C-1002')!;
  const a: Invoice = {
    id: 'INV-9020',
    customerId: 'C-1002',
    issued: '2026-01-01',
    source: 'WEB',
    paid: true,
    lines: [{ description: 'Metered supply', quantity: 10, unitPence: 195, kind: 'SUPPLY' }],
  };
  const b: Invoice = {
    id: 'INV-9021',
    customerId: 'C-1002',
    issued: '2026-02-01',
    source: 'WEB',
    paid: false,
    lines: [
      { description: 'Metered supply', quantity: 20, unitPence: 195, kind: 'SUPPLY' },
      { description: 'Backflow device test', quantity: 1, unitPence: 8500, kind: 'SERVICE' },
    ],
  };
  const statement = statementFor(customer, [a, b]);

  const expectedNet = statement.lines.reduce((sum, l) => sum + l.net, 0);
  const expectedVat = statement.lines.reduce((sum, l) => sum + l.vat, 0);
  const expectedTotal = statement.lines.reduce((sum, l) => sum + l.total, 0);

  assert.equal(statement.totals.net, expectedNet);
  assert.equal(statement.totals.vat, expectedVat);
  assert.equal(statement.totals.total, expectedTotal);
});

test('statement includes customer identity and a generatedAt timestamp', () => {
  const customer = customers.find((c) => c.id === 'C-1002')!;
  const before = Date.now();
  const statement = statementFor(customer, invoices);
  const after = Date.now();

  assert.equal(statement.customerName, 'Trelawney Foods Ltd');
  assert.equal(statement.address, 'Unit 6, Severnside Park, Avonmouth');
  const generated = Date.parse(statement.generatedAt);
  assert.ok(generated >= before && generated <= after);
});
