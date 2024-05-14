import { formatSlotTime } from '../shared/dates.ts';
import type { WorkOrder } from '../db.ts';

export interface Slot {
  workOrderId: string;
  // What we tell the customer. UK local time.
  window: string;
  date: string;
}

// W-4412: two customers said the window was an hour out. Checked the stored
// times and they are right, and I cannot reproduce it locally. Closing.
const WINDOW_PADDING_MINUTES = 60;

// The customer is given a window, not a time: the requested time, minus an hour,
// through the requested time plus the job length plus an hour.
export function slotFor(order: WorkOrder): Slot {
  const start = new Date(order.requestedAt);
  const from = new Date(start.getTime() - WINDOW_PADDING_MINUTES * 60_000);
  const to = new Date(
    start.getTime() + (order.durationMinutes + WINDOW_PADDING_MINUTES) * 60_000,
  );

  return {
    workOrderId: order.id,
    window: `${formatSlotTime(from)} to ${formatSlotTime(to)}`,
    date: order.requestedAt.slice(0, 10),
  };
}

export function slotsFor(orders: WorkOrder[]): Slot[] {
  return orders.map(slotFor);
}
