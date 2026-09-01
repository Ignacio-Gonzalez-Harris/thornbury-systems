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

// sameDay means "the same UK-local day", not the same UTC day.
test('sameDay treats a UK-local day as the unit, not the UTC day', () => {
  assert.equal(
    sameDay(new Date('2026-09-02T23:30:00Z'), new Date('2026-09-03T06:00:00Z')),
    true,
  );
  assert.equal(
    sameDay(new Date('2026-09-02T20:00:00Z'), new Date('2026-09-02T23:30:00Z')),
    false,
  );
});
