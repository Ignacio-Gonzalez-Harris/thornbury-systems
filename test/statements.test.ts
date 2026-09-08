import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Customer, Invoice } from '../src/db.ts';
import { statementFor } from '../src/invoices/statement.ts';

test('statement orders invoices and separates paid from outstanding totals', () => {
  const customer: Customer = {
    id: 'C-2001',
    name: 'Test Customer',
    address: '1 Test Road',
    accountType: 'COMMERCIAL',
    vatRegistered: true,
  };
  const invoices: Invoice[] = [
    {
      id: 'INV-2',
      customerId: customer.id,
      issued: '2026-07-01',
      source: 'WEB',
      paid: false,
      lines: [
        { description: 'Engineer visit', quantity: 1, unitPence: 100, kind: 'SERVICE' },
      ],
    },
    {
      id: 'INV-1',
      customerId: customer.id,
      issued: '2026-04-01',
      source: 'WEB',
      paid: true,
      lines: [
        { description: 'Metered supply', quantity: 2, unitPence: 100, kind: 'SUPPLY' },
      ],
    },
  ];

  assert.deepEqual(statementFor(customer, invoices), {
    customer: {
      id: 'C-2001',
      name: 'Test Customer',
      address: '1 Test Road',
    },
    invoices: [
      { id: 'INV-1', issued: '2026-04-01', paid: true, net: 200, vat: 40, total: 240 },
      { id: 'INV-2', issued: '2026-07-01', paid: false, net: 100, vat: 20, total: 120 },
    ],
    totals: {
      net: 300,
      vat: 60,
      invoiced: 360,
      paid: 240,
      outstanding: 120,
    },
  });
});
