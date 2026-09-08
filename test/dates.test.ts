import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isWorkingDay,
  addWorkingDays,
  toDateKey,
  sameDay,
  BANK_HOLIDAYS,
} from '../src/shared/dates.ts';

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

// The 2027 cliff (PRD 3.2): the holiday list is hardcoded, so on 1 January the
// year after the last entry isWorkingDay() would quietly start calling every
// bank holiday a working day -- the same failure mode as W-4412, wrong for part
// of the year with a green suite. This test is the alarm.
test('the bank holiday list still covers the current year', () => {
  // The current year as the UK sees it. new Date().getFullYear() would read the
  // SERVER's zone, which is exactly the mistake W-4412 was.
  const currentYear = toDateKey(new Date()).slice(0, 4);
  const covered = BANK_HOLIDAYS.filter((day) => day.startsWith(`${currentYear}-`));

  // England and Wales have exactly 8 permanent bank holidays in an ordinary
  // year, so 8 is the floor rather than an arbitrary number -- a year can gain
  // a one-off (a coronation, a jubilee) but never drops below 8.
  assert.ok(
    covered.length >= 8,
    `BANK_HOLIDAYS has ${covered.length} entries for ${currentYear}, expected at least 8. `
      + `Append ${currentYear}'s England and Wales bank holidays to BANK_HOLIDAYS in `
      + 'src/shared/dates.ts (see TB-02 in jobs/BACKLOG.md for the gov.uk feed that '
      + 'replaces this list for good).',
  );
});
