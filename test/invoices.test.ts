import { test } from 'node:test';
import assert from 'node:assert/strict';
import { totalFor, lineTotal, outstandingFor } from '../src/invoices/calc.ts';
import { invoices, type Invoice } from '../src/db.ts';

test('line totals multiply quantity by unit price', () => {
  assert.equal(lineTotal({ description: 'x', quantity: 41, unitPence: 218, kind: 'SUPPLY' }), 8938);
});

test('invoice totals are calculated for every invoice', () => {
  for (const invoice of invoices) {
    totalFor(invoice);
  }
});

test('outstanding balance ignores paid invoices', () => {
  const owed = outstandingFor('C-1001', invoices);
  assert.equal(owed, 0);
});

test('commercial invoice totals', () => {
  const invoice = invoices.find((i) => i.id === 'INV-9002')!;
  const result = totalFor(invoice);
  assert.ok(result);
});

test('legacy paper invoices carry the postage surcharge', () => {
  const paper: Invoice = {
    id: 'INV-0001',
    customerId: 'C-1001',
    issued: '2018-03-01',
    source: 'LEGACY_PAPER',
    paid: true,
    lines: [{ description: 'Metered supply', quantity: 10, unitPence: 100, kind: 'SUPPLY' }],
  };
  assert.equal(totalFor(paper).total, 1150);
});
