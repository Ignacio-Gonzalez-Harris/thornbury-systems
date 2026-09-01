// Date helpers shared by billing and scheduling.
//
// Everything the customer sees is UK local time. Everything we store is UTC.
// The two are not the same thing for half the year and this file is where that
// keeps going wrong.

export const BANK_HOLIDAYS_2026 = [
  '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04',
  '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28',
];

export function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// The Europe/London calendar date, as YYYY-MM-DD. This is the "day" the
// customer is on, not the UTC day the timestamp happens to fall in.
export function ukDateKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(d);
}

const UK_WEEKDAY_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  weekday: 'short',
});

export function isWorkingDay(d: Date): boolean {
  const weekday = UK_WEEKDAY_FORMAT.format(d);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return !BANK_HOLIDAYS_2026.includes(ukDateKey(d));
}

export function addWorkingDays(from: Date, n: number): Date {
  const d = new Date(from.getTime());
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (isWorkingDay(d)) left--;
  }
  return d;
}

// What the customer is told their appointment time is.
export function formatSlotTime(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d);
}

export function sameDay(a: Date, b: Date): boolean {
  return ukDateKey(a) === ukDateKey(b);
}
