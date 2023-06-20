// Reads the fixed width export from the desktop product and creates invoices
// with source LEGACY_PAPER. Runs nightly until the last paper run goes out.
import { invoices, type Invoice } from '../db.ts';

export function importPaperRun(rows: string[]): Invoice[] {
  const made: Invoice[] = [];
  for (const row of rows) {
    made.push({
      id: row.slice(0, 8).trim(),
      customerId: row.slice(8, 16).trim(),
      issued: row.slice(16, 26),
      source: 'LEGACY_PAPER',
      paid: false,
      lines: [{ description: 'Imported balance', quantity: 1, unitPence: Number(row.slice(26, 34)), kind: 'SUPPLY' }],
    });
  }
  invoices.push(...made);
  return made;
}
