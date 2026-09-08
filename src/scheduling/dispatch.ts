import { engineers, type Engineer, type WorkOrder } from '../db.ts';
import { sameDay } from '../shared/dates.ts';

export interface Assignment {
  workOrderId: string;
  engineerId: string;
  address: string;
  startsAt: string;
}

function canDo(engineer: Engineer, order: WorkOrder): boolean {
  return engineer.skills.includes(order.requires);
}

// Addresses are typed in by whoever takes the call, so the same house shows up
// with commas, full stops and other stray punctuation depending on who answered.
// Treat any run of punctuation as a word boundary (not a letter/digit to strip),
// so it can't merge two words that were only ever separated by a comma with no
// following space. Deliberately does NOT touch letters or digits: street-type
// abbreviations (Road/Rd, St/Steps) and house-number suffixes (14 vs 14a) must
// stay distinct, or two different houses would collapse into one visit.
function canonicalAddress(address: string): string {
  return address
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// One visit per address per day. Sending two vans to the same house on the same
// morning is the single biggest source of complaints on the support queue.
function alreadyVisiting(address: string, when: Date, planned: Assignment[]): boolean {
  return planned.some(
    (a) => canonicalAddress(a.address) === canonicalAddress(address)
      && sameDay(new Date(a.startsAt), when),
  );
}

export function dispatch(orders: WorkOrder[]): Assignment[] {
  const planned: Assignment[] = [];

  for (const order of orders) {
    if (order.status !== 'QUEUED') continue;
    const when = new Date(order.requestedAt);

    if (alreadyVisiting(order.address, when, planned)) continue;

    const engineer = engineers.find((e) => canDo(e, order));
    if (!engineer) continue;

    planned.push({
      workOrderId: order.id,
      engineerId: engineer.id,
      address: order.address,
      startsAt: order.requestedAt,
    });
  }

  return planned;
}
