import { test } from 'node:test';
import assert from 'node:assert/strict';
import { totalFor, lineTotal, outstandingFor } from '../src/invoices/calc.ts';
import { customers, invoices, type Customer, type Invoice } from '../src/db.ts';

function customerFor(customerId: string): Customer {
  return customers.find((c) => c.id === customerId)!;
}

test('line totals multiply quantity by unit price', () => {
  assert.equal(lineTotal({ description: 'x', quantity: 41, unitPence: 218, kind: 'SUPPLY' }), 8938);
});

test('invoice totals are calculated for every invoice', () => {
  for (const invoice of invoices) {
    totalFor(invoice, customerFor(invoice.customerId));
  }
});

test('outstanding balance ignores paid invoices', () => {
  const owed = outstandingFor('C-1001', invoices);
  assert.equal(owed, 0);
});

test('commercial invoice totals', () => {
  // Supply is standard-rated for commercial customers, so the whole net
  // (supply + standing charge + service) is vatable, not just the service line.
  const invoice = invoices.find((i) => i.id === 'INV-9002')!;
  assert.deepEqual(totalFor(invoice, customerFor(invoice.customerId)), {
    net: 245000,
    vat: 49000,
    total: 294000,
  });
});

test('outstanding balance includes VAT', () => {
  assert.equal(outstandingFor('C-1002', invoices), 294000);
});

test('domestic supply-only invoice stays zero-rated', () => {
  const invoice = invoices.find((i) => i.id === 'INV-9001')!;
  assert.deepEqual(totalFor(invoice, customerFor(invoice.customerId)), {
    net: 11338,
    vat: 0,
    total: 11338,
  });
});

test('commercial supply-only invoice is standard-rated', () => {
  const invoice = invoices.find((i) => i.id === 'INV-9004')!;
  assert.deepEqual(totalFor(invoice, customerFor(invoice.customerId)), {
    net: 563400,
    vat: 112680,
    total: 676080,
  });
});

test('domestic invoice only charges VAT on the service line', () => {
  const invoice = invoices.find((i) => i.id === 'INV-9003')!;
  assert.deepEqual(totalFor(invoice, customerFor(invoice.customerId)), {
    net: 23594,
    vat: 2800,
    total: 26394,
  });
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
  assert.equal(totalFor(paper, customerFor(paper.customerId)).total, 1150);
});

test('outstandingFor throws for an unknown customer instead of silently zero-rating', () => {
  assert.throws(() => outstandingFor('C-9999', invoices));
});
