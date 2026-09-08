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

test('customer slots use UK local time when the server runs in UTC', () => {
  const originalTimezone = process.env.TZ;
  process.env.TZ = 'UTC';

  try {
    const order = workOrders.find((workOrder) => workOrder.id === 'W-5006')!;
    assert.deepEqual(slotFor(order), {
      workOrderId: 'W-5006',
      window: '23:30 to 02:15',
      date: '2026-09-03',
    });
  } finally {
    if (originalTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimezone;
    }
  }
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
