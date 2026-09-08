// Persistence for the in-memory tables in db.ts.
//
// The rest of the codebase treats db.ts as if it were the SQL Server tables.
// This file is the bit that makes writes survive a restart: the arrays stay in
// memory and are the source of truth for a running process, and every write
// flushes the whole lot to one JSON file.
//
// Deliberately NOT concurrent-safe. One process, one file, last write wins.
// That is fine for the single API process we run today and is the first thing
// that breaks if we ever run two.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Snapshot {
  customers: unknown[];
  invoices: unknown[];
  engineers: unknown[];
  workOrders: unknown[];
}

const DEFAULT_STORE_PATH = 'data/store.json';

const SNAPSHOT_TABLES = ['customers', 'invoices', 'engineers', 'workOrders'] as const;

// Persistence is opt-in, and that is on purpose.
//
// The tests import db.ts directly and mutate the arrays in place (see
// test/server.test.ts, which removes a customer and puts it back). If the store
// loaded on every import, one test run would leave its scribbles on disk and the
// next run would start from them. So: a file is only used when this process IS
// the server, or when THORNBURY_STORE names one explicitly. A test that wants
// persistence points that variable at a temporary file.
export function storePath(): string | null {
  const configured = process.env.THORNBURY_STORE;
  if (configured !== undefined) {
    return configured === '' ? null : configured;
  }
  return process.argv[1]?.endsWith('server.ts') ? DEFAULT_STORE_PATH : null;
}

export function load(path: string): Snapshot | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    // A missing file is legitimate first boot, not corruption: db.ts lays the
    // seed data down and carries on. Every OTHER read failure is real and rethrows.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  const parsed = JSON.parse(raw) as Partial<Snapshot>;

  // A missing or non-array table is a hard error, NOT an empty table.
  //
  // This used to be `parsed.customers ?? []` per table, and that was silent data
  // loss: a snapshot that is valid JSON but has lost a key — a hand-edit, an
  // older schema, an aborted third-party write — would come back as an empty
  // array, db.ts would empty the live table to match, and the very first write
  // would call persist() and rewrite the file with the table permanently gone.
  // No error, no log line. The temp-file-and-rename in save() protects against a
  // torn write; it does nothing about this. In a billing system, refusing to boot
  // and naming the file to repair is the only safe answer.
  const broken: string[] = [];
  for (const table of SNAPSHOT_TABLES) {
    const value = parsed[table];
    if (value === undefined) broken.push(`${table} (missing)`);
    else if (!Array.isArray(value)) broken.push(`${table} (not an array)`);
  }
  if (broken.length > 0) {
    throw new Error(
      `Corrupt store snapshot at ${path}: ${broken.join(', ')}. ` +
        'Repair the file or delete it to start from seed data.',
    );
  }

  return {
    customers: parsed.customers as unknown[],
    invoices: parsed.invoices as unknown[],
    engineers: parsed.engineers as unknown[],
    workOrders: parsed.workOrders as unknown[],
  };
}

// Write to a sibling temp file and rename over the target, so a crash halfway
// through leaves the previous snapshot intact rather than a truncated one.
export function save(path: string, snapshot: Snapshot): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
}
