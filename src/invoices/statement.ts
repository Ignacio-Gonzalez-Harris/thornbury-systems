import { sum, format, type Pence } from '../shared/money.ts';
import type { Customer, CustomerId, Invoice } from '../db.ts';
import { totalFor, outstandingFor } from './calc.ts';

export interface StatementLine {
  invoiceId: string;
  issued: string;
  net: Pence;
  vat: Pence;
  total: Pence;
  paid: boolean;
}

export interface StatementTotals {
  net: Pence;
  vat: Pence;
  total: Pence;
  outstanding: Pence;
}

export interface Statement {
  customerId: CustomerId;
  customerName: string;
  address: string;
  generatedAt: string;
  lines: StatementLine[];
  totals: StatementTotals;
  display: {
    total: string;
    outstanding: string;
  };
}

// One line per invoice plus summary totals, requested by Trelawney Foods so
// they stop reconciling four invoice PDFs by hand each quarter. See
// jobs/JOB-C-statements.md for the shape decision.
export function statementFor(customer: Customer, invoices: Invoice[]): Statement {
  const customerInvoices = invoices
    .filter((i) => i.customerId === customer.id)
    .slice()
    .sort((a, b) => a.issued.localeCompare(b.issued));

  const lines: StatementLine[] = customerInvoices.map((invoice) => {
    const t = totalFor(invoice);
    return {
      invoiceId: invoice.id,
      issued: invoice.issued,
      net: t.net,
      vat: t.vat,
      total: t.total,
      paid: invoice.paid,
    };
  });

  const totals: StatementTotals = {
    net: sum(lines.map((l) => l.net)),
    vat: sum(lines.map((l) => l.vat)),
    total: sum(lines.map((l) => l.total)),
    outstanding: outstandingFor(customer.id, invoices),
  };

  return {
    customerId: customer.id,
    customerName: customer.name,
    address: customer.address,
    generatedAt: new Date().toISOString(),
    lines,
    totals,
    display: {
      total: format(totals.total),
      outstanding: format(totals.outstanding),
    },
  };
}
