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

// One visit per address per day. Sending two vans to the same house on the same
// morning is the single biggest source of complaints on the support queue.
function alreadyVisiting(address: string, when: Date, planned: Assignment[]): boolean {
  return planned.some(
    (a) => a.address === address && sameDay(new Date(a.startsAt), when),
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
