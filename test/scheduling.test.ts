import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slotFor } from '../src/scheduling/slots.ts';
import { dispatch } from '../src/scheduling/dispatch.ts';
import { workOrders } from '../src/db.ts';

test('a customer is quoted a window around the requested time', () => {
  const order = workOrders.find((w) => w.id === 'W-5001')!;
  const slot = slotFor(order);
  assert.equal(slot.window, '08:00 to 11:00');
  assert.equal(slot.date, '2026-09-02');
});

// W-5006: requested late at night UTC, which is already past midnight UK
// local (BST, summer). The customer must be given the UK-local day, not the
// UTC day the timestamp happens to fall in.
test('a late UTC request rolls over to the next UK day', () => {
  const order = workOrders.find((w) => w.id === 'W-5006')!;
  const slot = slotFor(order);
  assert.equal(slot.window, '23:30 to 02:15');
  assert.equal(slot.date, '2026-09-03');
});

// Winter (GMT, no DST offset) case, to make sure the fix isn't BST-only.
test('a winter request is quoted in GMT with no day rollover', () => {
  const order = {
    id: 'W-TEST-WINTER',
    customerId: 'C-1001',
    address: '14 Ashfield Row, Bristol',
    requires: 'METER',
    requestedAt: '2026-01-15T10:00:00Z',
    durationMinutes: 120,
    status: 'QUEUED' as const,
  };
  const slot = slotFor(order);
  assert.equal(slot.window, '09:00 to 13:00');
  assert.equal(slot.date, '2026-01-15');
});

test('dispatch only plans queued work', () => {
  const plan = dispatch(workOrders.map((w) => ({ ...w, status: 'DONE' as const })));
  assert.equal(plan.length, 0);
});

test('dispatch matches the required skill', () => {
  const plan = dispatch(workOrders);
  const backflow = plan.find((a) => a.workOrderId === 'W-5003');
  assert.equal(backflow?.engineerId, 'E-02');
});
