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
  // INV-9002: 1120*195 + 9600 + 2*8500 = 245000 net; VAT is 20% of the
  // SERVICE subtotal only (2*8500 = 17000) = 3400; total = 248400.
  const invoice = invoices.find((i) => i.id === 'INV-9002')!;
  const result = totalFor(invoice);
  assert.equal(result.net, 245000);
  assert.equal(result.vat, 3400);
  assert.equal(result.total, 248400);
});

test('invoices with no SERVICE lines carry no VAT', () => {
  // INV-9001: 41*218 + 2400 = 11338 net, all SUPPLY, so vat 0 and total = net.
  const invoice = invoices.find((i) => i.id === 'INV-9001')!;
  const result = totalFor(invoice);
  assert.equal(result.net, 11338);
  assert.equal(result.vat, 0);
  assert.equal(result.total, 11338);
});

test('VAT is charged only on the SERVICE subtotal', () => {
  // INV-9003: 33*218 + 2400 + 14000 = 23594 net; VAT is 20% of the SERVICE
  // subtotal (14000) = 2800; total = 26394.
  const invoice = invoices.find((i) => i.id === 'INV-9003')!;
  const result = totalFor(invoice);
  assert.equal(result.net, 23594);
  assert.equal(result.vat, 2800);
  assert.equal(result.total, 26394);
});

test('legacy paper invoices carry the postage surcharge, zero-rated', () => {
  const paper: Invoice = {
    id: 'INV-0001',
    customerId: 'C-1001',
    issued: '2018-03-01',
    source: 'LEGACY_PAPER',
    paid: true,
    lines: [{ description: 'Metered supply', quantity: 10, unitPence: 100, kind: 'SUPPLY' }],
  };
  const result = totalFor(paper);
  assert.equal(result.net, 1150);
  assert.equal(result.vat, 0);
  assert.equal(result.total, 1150);
});

test('outstanding balance is VAT-inclusive', () => {
  // C-1002's only invoice is the unpaid INV-9002 (total 248400 incl. VAT).
  const owed = outstandingFor('C-1002', invoices);
  assert.equal(owed, 248400);
});
