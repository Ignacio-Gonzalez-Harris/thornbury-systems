import { formatSlotDate, formatSlotTime, sameDay } from '../shared/dates.ts';
import type { WorkOrder } from '../db.ts';

export interface Slot {
  workOrderId: string;
  // What we tell the customer. UK local time.
  window: string;
  date: string;
  // The exact window bounds as UTC instants, so the front end can render the
  // window itself rather than parsing our display string back apart.
  from: string;
  to: string;
}

// W-4412: two customers said the window was an hour out. Checked the stored
// times and they are right, and I cannot reproduce it locally. Closing.
// W-4412 reopened Jul 25. Still green on my machine and on the build box.
// Closing again. If it comes back a third time somebody else can have it.
const WINDOW_PADDING_MINUTES = 60;

// The customer is given a window, not a time: the requested time, minus an hour,
// through the requested time plus the job length plus an hour.
export function slotFor(order: WorkOrder): Slot {
  const start = new Date(order.requestedAt);
  const from = new Date(start.getTime() - WINDOW_PADDING_MINUTES * 60_000);
  const to = new Date(
    start.getTime() + (order.durationMinutes + WINDOW_PADDING_MINUTES) * 60_000,
  );

  // PRD 3.3 asked us to mark the rollover, and the fix must not contradict the
  // date. A relative word like "(next day)" has to be relative to something,
  // and `date` is not that something -- it is the appointment day, which for
  // W-5006 is the day AFTER the window opens. It is also only ever right for a
  // one-day hop: durationMinutes has no upper bound (src/crud.ts validates only
  // { min: 1 }), so a mistyped duration produces a window several days long.
  // So when the window spans more than one UK-local day we spell both dates out
  // and the string stands on its own, whatever else is on the screen.
  const withinOneDay = sameDay(from, to);
  const window = withinOneDay
    ? `${formatSlotTime(from)} to ${formatSlotTime(to)}`
    : `${formatSlotDate(from)} ${formatSlotTime(from)} to ${formatSlotDate(to)} ${formatSlotTime(to)}`;

  return {
    workOrderId: order.id,
    window,
    // The UK-local calendar day of the APPOINTMENT, not of the window's opening
    // edge. The front end renders `date` on its own as the day of the visit, so
    // moving it to `from` told Trelawney their 00:30 job was on 2026-09-02 --
    // the day before it happens, which is W-4412's phone call all over again.
    // The hour of padding may legitimately open the window on the previous day;
    // `date` and the window are allowed to disagree, and the window string above
    // carries its own dates so it resolves the disagreement by itself.
    date: formatSlotDate(start),
    from: from.toISOString(),
    to: to.toISOString(),
  };
}

export function slotsFor(orders: WorkOrder[]): Slot[] {
  return orders.map(slotFor);
}
