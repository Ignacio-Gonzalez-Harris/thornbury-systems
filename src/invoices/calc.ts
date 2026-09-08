import { percentOf, sum, type Pence } from '../shared/money.ts';
import { customers, type Customer, type Invoice, type LineItem } from '../db.ts';

export interface InvoiceTotal {
  net: Pence;
  vat: Pence;
  total: Pence;
}

const STANDARD_VAT_PERCENT = 20;

export function lineTotal(line: LineItem): Pence {
  return line.quantity * line.unitPence;
}

// Paper invoices carried a printing and postage charge that the web product
// never had. Kept so historic invoices still reconcile. Not part of the VAT base.
function legacySurcharge(invoice: Invoice): Pence {
  if (invoice.source === 'LEGACY_PAPER') {
    return 150;
  }
  return 0;
}

// SERVICE (engineer work) is standard-rated for everyone. SUPPLY (metered
// water) is zero-rated for domestic customers but standard-rated for
// commercial/business customers under UK VAT rules.
function isVatable(line: LineItem, customer: Customer): boolean {
  if (line.kind === 'SERVICE') {
    return true;
  }
  return customer.accountType === 'COMMERCIAL';
}

export function totalFor(invoice: Invoice, customer: Customer): InvoiceTotal {
  const net = sum(invoice.lines.map(lineTotal)) + legacySurcharge(invoice);
  const vatable = sum(
    invoice.lines.filter((line) => isVatable(line, customer)).map(lineTotal),
  );
  const vat = percentOf(vatable, STANDARD_VAT_PERCENT);
  return { net, vat, total: net + vat };
}

function customerFor(customerId: string): Customer {
  const customer = customers.find((c) => c.id === customerId);
  if (!customer) {
    throw new Error(`No customer found for id ${customerId}`);
  }
  return customer;
}

export function outstandingFor(customerId: string, all: Invoice[]): Pence {
  const customer = customerFor(customerId);
  return sum(
    all
      .filter((i) => i.customerId === customerId && !i.paid)
      .map((i) => totalFor(i, customer).total),
  );
}
