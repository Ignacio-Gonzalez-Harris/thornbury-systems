import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slotFor } from '../src/scheduling/slots.ts';
import { dispatch } from '../src/scheduling/dispatch.ts';
import { workOrders } from '../src/db.ts';

test('a customer is quoted a window around the requested time', () => {
  const order = workOrders.find((w) => w.id === 'W-5001')!;
  assert.deepEqual(slotFor(order), {
    workOrderId: 'W-5001',
    window: '08:00 to 11:00',
    date: '2026-09-02',
    from: '2026-09-02T07:00:00.000Z',
    to: '2026-09-02T10:00:00.000Z',
  });
});

test('a window that stays inside one day carries no dates in the string', () => {
  const order = workOrders.find((w) => w.id === 'W-5001')!;
  const { window } = slotFor(order);
  assert.equal(window, '08:00 to 11:00');
  assert.ok(!window.includes('next day'));
});

test('customer slots use UK local time when the server runs in UTC', () => {
  const originalTimezone = process.env.TZ;
  process.env.TZ = 'UTC';

  try {
    // PRD 3.3: the window opens 23:30 on the 2nd UK time and closes 02:15 on
    // the 3rd. `date` stays the appointment day (00:30 on the 3rd UK time) --
    // it is what the front end renders as the day of the visit -- and the
    // window carries its own dates so the two cannot be read as contradicting.
    const order = workOrders.find((workOrder) => workOrder.id === 'W-5006')!;
    assert.deepEqual(slotFor(order), {
      workOrderId: 'W-5006',
      window: '2026-09-02 23:30 to 2026-09-03 02:15',
      date: '2026-09-03',
      from: '2026-09-02T22:30:00.000Z',
      to: '2026-09-03T01:15:00.000Z',
    });
  } finally {
    if (originalTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimezone;
    }
  }
});

test('a window spanning several days names the real end date, not "next day"', () => {
  // durationMinutes has no upper bound (src/crud.ts validates only { min: 1 }),
  // so a mistyped duration lands here. A "(next day)" suffix would promise the
  // 3rd for a window that actually closes on the 4th.
  const order = workOrders.find((w) => w.id === 'W-5001')!;
  const slot = slotFor({ ...order, durationMinutes: 3000 });

  assert.equal(slot.window, '2026-09-02 08:00 to 2026-09-04 12:00');
  assert.equal(slot.date, '2026-09-02');
  assert.equal(slot.to, '2026-09-04T11:00:00.000Z');
  assert.ok(!slot.window.includes('next day'));
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

test('dispatch plans one visit for differently typed versions of an address', () => {
  const ashfieldOrders = workOrders.filter(
    (order) => order.id === 'W-5001' || order.id === 'W-5002',
  ).map((order) => order.id === 'W-5001'
    ? { ...order, address: '  14 Ashfield   Row, Bristol  ' }
    : order);

  assert.deepEqual(
    dispatch(ashfieldOrders).map((assignment) => ({
      workOrderId: assignment.workOrderId,
      address: assignment.address,
    })),
    [{ workOrderId: 'W-5001', address: '  14 Ashfield   Row, Bristol  ' }],
  );
});

test('dispatch plans one visit when a comma and a full stop are the only difference', () => {
  const punctuationOrders = workOrders.filter(
    (order) => order.id === 'W-5001' || order.id === 'W-5002',
  ).map((order) => order.id === 'W-5001'
    ? { ...order, address: '14 Ashfield Row, Bristol' }
    : { ...order, address: '14 Ashfield Row Bristol.' });

  assert.equal(dispatch(punctuationOrders).length, 1);
});

test('dispatch still plans separate visits for genuinely different addresses', () => {
  const distinctOrders = workOrders.filter(
    (order) => order.id === 'W-5001' || order.id === 'W-5002',
  ).map((order) => order.id === 'W-5001'
    ? { ...order, address: '12 Bell Street, Thornbury' }
    : { ...order, address: '12 Bell Steps, Thornbury' });

  assert.equal(dispatch(distinctOrders).length, 2);
});

test('dispatch plans an out-of-hours visit as a separate UK-local day even when the server runs in UTC', () => {
  const originalTimezone = process.env.TZ;
  process.env.TZ = 'UTC';

  try {
    const plannedIds = dispatch(workOrders).map((assignment) => assignment.workOrderId);
    assert.ok(plannedIds.includes('W-5003'), 'expected W-5003 to be planned');
    assert.ok(plannedIds.includes('W-5006'), 'expected W-5006 to be planned');
  } finally {
    if (originalTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimezone;
    }
  }
});

test('dispatch does not send a second van to an address already DISPATCHED that day', () => {
  // JOB B, the half that b2bb46e did not fix: Mrs Whitcombe's meter job went out
  // at 08:00 and is DISPATCHED, so the next run through the queue must not plan
  // the 08:30 leak job at the same house.
  const whitcombeOrders = workOrders
    .filter((order) => order.id === 'W-5001' || order.id === 'W-5002')
    .map((order) => order.id === 'W-5001'
      ? { ...order, status: 'DISPATCHED' as const, engineerId: 'E-01' }
      : { ...order, address: '14 Ashfield Row, Bristol' });

  assert.deepEqual(dispatch(whitcombeOrders), []);
});

test('dispatch does not send a second van to an address already visited that day', () => {
  const doneThenQueued = workOrders
    .filter((order) => order.id === 'W-5001' || order.id === 'W-5002')
    .map((order) => order.id === 'W-5001'
      ? { ...order, status: 'DONE' as const }
      : order);

  assert.deepEqual(dispatch(doneThenQueued), []);
});

test('a DISPATCHED order on another day does not block todays visit', () => {
  const yesterdayThenToday = workOrders
    .filter((order) => order.id === 'W-5001' || order.id === 'W-5002')
    .map((order) => order.id === 'W-5001'
      ? { ...order, status: 'DISPATCHED' as const, requestedAt: '2026-09-01T08:00:00Z' }
      : order);

  assert.deepEqual(
    dispatch(yesterdayThenToday).map((assignment) => assignment.workOrderId),
    ['W-5002'],
  );
});
