// Helper script for the persistence round-trip in test/crud.test.ts. NOT a test
// file — the runner glob is test/**/*.test.ts, so node --test never collects it.
//
// It has to be a separate process because db.ts calls storePath() once, at
// import time, and loads the snapshot there. A row written by this process is
// already in memory, so re-reading it here would prove nothing. The round trip
// is therefore two runs of this script with the same THORNBURY_STORE:
//
//   write  — create a customer, print the id it was given
//   read   — a fresh process, loading the snapshot from disk, looks it back up
//
// Each run prints one line of JSON on stdout for the test to assert on.

import { createCustomer } from '../../src/crud.ts';
import { customers } from '../../src/db.ts';

const MARKER = 'Roundtrip Reservoir Ltd';

const mode = process.argv[2];

if (mode === 'write') {
  const created = createCustomer({
    name: MARKER,
    address: 'Unit 9, Severnside Park, Avonmouth',
    accountType: 'COMMERCIAL',
    vatRegistered: true,
  });
  process.stdout.write(JSON.stringify({ id: created.id, total: customers.length }));
} else if (mode === 'read') {
  const found = customers.find((customer) => customer.name === MARKER);
  process.stdout.write(JSON.stringify({ id: found?.id ?? null, total: customers.length }));
} else {
  throw new Error(`unknown mode: ${mode} (expected 'write' or 'read')`);
}
