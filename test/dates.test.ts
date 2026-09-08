import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWorkingDay, addWorkingDays, toDateKey, sameDay } from '../src/shared/dates.ts';

test('weekends are not working days', () => {
  assert.equal(isWorkingDay(new Date('2026-09-05T12:00:00Z')), false);
  assert.equal(isWorkingDay(new Date('2026-09-06T12:00:00Z')), false);
});

test('bank holidays are not working days', () => {
  assert.equal(isWorkingDay(new Date('2026-12-25T12:00:00Z')), false);
});

test('adding working days skips the weekend', () => {
  const friday = new Date('2026-09-04T12:00:00Z');
  assert.equal(toDateKey(addWorkingDays(friday, 1)), '2026-09-07');
});

test('working days follow UK local time when the server runs in UTC', () => {
  const originalTimezone = process.env.TZ;
  process.env.TZ = 'UTC';

  try {
    // 00:30 on Tuesday 1 September UK time, an ordinary working day.
    assert.equal(isWorkingDay(new Date('2026-08-31T23:30:00Z')), true);
    // 00:30 on Saturday 5 September UK time.
    assert.equal(isWorkingDay(new Date('2026-09-04T23:30:00Z')), false);
    // 00:30 on Monday 7 September UK time.
    assert.equal(isWorkingDay(new Date('2026-09-06T23:30:00Z')), true);
  } finally {
    if (originalTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimezone;
    }
  }
});

test('a timestamp late in the UK evening belongs to the next UK day', () => {
  const originalTimezone = process.env.TZ;
  process.env.TZ = 'UTC';

  try {
    assert.equal(
      sameDay(new Date('2026-09-02T09:00:00Z'), new Date('2026-09-02T23:30:00Z')),
      false,
    );
    assert.equal(toDateKey(new Date('2026-09-02T23:30:00Z')), '2026-09-03');
  } finally {
    if (originalTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimezone;
    }
  }
});
