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

// A van at an address on a UK-local day, whether it was planned in this call or
// committed by an earlier one.
interface Visit {
  address: string;
  when: Date;
}

// One visit per address per day. Sending two vans to the same house on the same
// morning is the single biggest source of complaints on the support queue.
function alreadyVisiting(address: string, when: Date, visits: Visit[]): boolean {
  return visits.some(
    (visit) => canonicalAddress(visit.address) === canonicalAddress(address)
      && sameDay(visit.when, when),
  );
}

export function dispatch(orders: WorkOrder[]): Assignment[] {
  const planned: Assignment[] = [];

  // The duplicate check used to compare only against what THIS call planned, so a
  // job already DISPATCHED to a house this morning was invisible to it and the
  // dispatcher's next run sent a second van. Real dispatchers run this repeatedly
  // through the day, which is why Marcus sees it most weeks. Every order that is
  // no longer QUEUED is a visit that has already been committed for that day, so
  // it counts against the address exactly like a freshly planned one.
  const visits: Visit[] = orders
    .filter((order) => order.status !== 'QUEUED')
    .map((order) => ({ address: order.address, when: new Date(order.requestedAt) }));

  for (const order of orders) {
    if (order.status !== 'QUEUED') continue;
    const when = new Date(order.requestedAt);

    if (alreadyVisiting(order.address, when, visits)) continue;

    const engineer = engineers.find((e) => canDo(e, order));
    if (!engineer) continue;

    planned.push({
      workOrderId: order.id,
      engineerId: engineer.id,
      address: order.address,
      startsAt: order.requestedAt,
    });
    visits.push({ address: order.address, when });
  }

  return planned;
}
