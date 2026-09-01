import { sum, percentOf, type Pence } from '../shared/money.ts';
import type { Invoice, LineItem } from '../db.ts';

export interface InvoiceTotal {
  net: Pence;
  vat: Pence;
  total: Pence;
}

export function lineTotal(line: LineItem): Pence {
  return line.quantity * line.unitPence;
}

// Paper invoices carried a printing and postage charge that the web product
// never had. Kept so historic invoices still reconcile.
function legacySurcharge(invoice: Invoice): Pence {
  if (invoice.source === 'LEGACY_PAPER') {
    return 150;
  }
  return 0;
}

// VAT policy (2026-09-01 assumption, pending Finance's real rules — see
// jobs/JOB-A-vat.md): SERVICE lines (engineer work) carry 20% VAT; SUPPLY
// lines (metered water) are zero-rated, as is the legacy paper surcharge.
// VAT is computed once per invoice, on the SERVICE subtotal, rounded half up
// to the penny.
export function totalFor(invoice: Invoice): InvoiceTotal {
  const net = sum(invoice.lines.map(lineTotal)) + legacySurcharge(invoice);
  const serviceSubtotal = sum(
    invoice.lines.filter((l) => l.kind === 'SERVICE').map(lineTotal),
  );
  const vat = percentOf(serviceSubtotal, 20);
  return { net, vat, total: net + vat };
}

export function outstandingFor(customerId: string, all: Invoice[]): Pence {
  return sum(
    all.filter((i) => i.customerId === customerId && !i.paid).map((i) => totalFor(i).total),
  );
}
