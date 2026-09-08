// Write operations for the tables in db.ts.
//
// Everything here mutates the arrays in place and then calls persist(). The read
// paths (invoices/, scheduling/) hold the same array references, so a write is
// visible to them immediately.
//
// Two rules are enforced here rather than left to the caller:
//
//   1. A PAID invoice is closed. It cannot be edited or deleted. Correcting a
//      settled invoice by editing it in place loses the thing Finance needs most,
//      which is what the customer was actually charged. See the PRD: the agreed
//      position is "lock once paid", and the known consequence is that an invoice
//      marked paid by mistake cannot be un-marked through the API.
//
//   2. Nothing may be deleted out from under something that points at it. No
//      cascades: a delete that would orphan a row is refused with a 409 and the
//      caller decides what to do.

import {
  customers,
  engineers,
  invoices,
  persist,
  workOrders,
  type Customer,
  type Engineer,
  type Invoice,
  type LineItem,
  type WorkOrder,
} from './db.ts';

// Note the explicit field: `constructor(readonly status: number)` is a TypeScript
// parameter property, and --experimental-strip-types refuses it (it would have to
// emit an assignment, and strip-only mode only deletes types). Same reason enums,
// namespaces and decorators are unavailable in this codebase.
export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const badRequest = (message: string) => new ApiError(400, message);
const notFound = (message: string) => new ApiError(404, message);
const conflict = (message: string) => new ApiError(409, message);

// --- field validation -------------------------------------------------------

const ACCOUNT_TYPES = ['DOMESTIC', 'COMMERCIAL'] as const;
const INVOICE_SOURCES = ['WEB', 'BATCH', 'LEGACY_PAPER'] as const;
const LINE_KINDS = ['SUPPLY', 'SERVICE'] as const;
const WORK_ORDER_STATUSES = ['QUEUED', 'DISPATCHED', 'DONE'] as const;

function asObject(body: unknown, what: string): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw badRequest(`${what} must be a JSON object`);
  }
  return body as Record<string, unknown>;
}

// Unknown keys are rejected rather than ignored. A typo in a field name is much
// easier to find as a 400 than as a write that silently did nothing.
function rejectUnknownFields(body: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw badRequest(`unknown field(s): ${unknown.join(', ')}`);
  }
}

function text(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw badRequest(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function flag(body: Record<string, unknown>, field: string): boolean {
  const value = body[field];
  if (typeof value !== 'boolean') {
    throw badRequest(`${field} must be true or false`);
  }
  return value;
}

function oneOf<T extends string>(
  body: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T {
  const value = body[field];
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw badRequest(`${field} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

// Money and quantities are integers. The one rule everybody agreed on is that
// nothing below the UI holds a fractional penny, so a float here is a 400.
function wholeNumber(
  body: Record<string, unknown>,
  field: string,
  { min }: { min: number },
): number {
  const value = body[field];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw badRequest(`${field} must be a whole number`);
  }
  if (value < min) {
    throw badRequest(`${field} must be ${min} or more`);
  }
  return value;
}

function calendarDate(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw badRequest(`${field} must be a date in YYYY-MM-DD form`);
  }
  // The toISOString().slice(0, 10) below looks like the W-4412 pattern PRD 7
  // bans, and is not: the day is the caller's own literal, parsed at an explicit
  // 'Z', and the slice only round-trips it to reject dates that do not exist
  // (2026-02-30 rolls forward to 03-02). Nothing here reads the server's zone.
  // Do not copy it anywhere that derives a calendar day from an instant — that
  // is what shared/dates.ts toDateKey() is for.
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw badRequest(`${field} is not a real date`);
  }
  return value;
}

// requestedAt must carry a zone. A naive '2026-09-02T23:30:00' is exactly the
// ambiguity that produced W-4412 twice, so it is refused at the door rather than
// guessed at. Stored canonically as UTC.
function instant(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string') {
    throw badRequest(`${field} must be an ISO-8601 timestamp`);
  }
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    throw badRequest(
      `${field} must state its timezone, e.g. 2026-09-02T23:30:00Z — times without one are ambiguous`,
    );
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest(`${field} is not a valid timestamp`);
  }
  return parsed.toISOString();
}

function skillList(body: Record<string, unknown>, field: string): string[] {
  const value = body[field];
  if (!Array.isArray(value) || value.length === 0) {
    throw badRequest(`${field} must be a non-empty array of skill names`);
  }
  return value.map((skill, index) => {
    if (typeof skill !== 'string' || skill.trim() === '') {
      throw badRequest(`${field}[${index}] must be a non-empty string`);
    }
    return skill.trim();
  });
}

const LINE_FIELDS = ['description', 'quantity', 'unitPence', 'kind'] as const;

function lineItems(body: Record<string, unknown>, field: string): LineItem[] {
  const value = body[field];
  if (!Array.isArray(value) || value.length === 0) {
    throw badRequest(`${field} must be a non-empty array of line items`);
  }
  return value.map((raw, index) => {
    const line = asObject(raw, `${field}[${index}]`);
    rejectUnknownFields(line, LINE_FIELDS);
    return {
      description: text(line, 'description'),
      quantity: wholeNumber(line, 'quantity', { min: 1 }),
      unitPence: wholeNumber(line, 'unitPence', { min: 0 }),
      kind: oneOf(line, 'kind', LINE_KINDS),
    };
  });
}

// --- identifiers ------------------------------------------------------------

// Ids are server-assigned. Each collection keeps the width it already uses
// (C-1001 is four digits, E-01 is two) so new rows look like the old ones.
function nextId(prefix: string, existing: { id: string }[]): string {
  let width = 4;
  let highest = 0;
  for (const row of existing) {
    if (!row.id.startsWith(prefix)) continue;
    const digits = row.id.slice(prefix.length);
    if (!/^\d+$/.test(digits)) continue;
    width = digits.length;
    highest = Math.max(highest, Number(digits));
  }
  return `${prefix}${String(highest + 1).padStart(width, '0')}`;
}

function findOrThrow<T extends { id: string }>(rows: T[], id: string, what: string): T {
  const row = rows.find((candidate) => candidate.id === id);
  if (!row) throw notFound(`no such ${what}`);
  return row;
}

// PATCH bodies are partial, so a field is only validated when it is present.
function patch<T>(
  body: Record<string, unknown>,
  field: string,
  read: () => T,
): { [key: string]: T } | Record<string, never> {
  return field in body ? { [field]: read() } : {};
}

// --- customers --------------------------------------------------------------

const CUSTOMER_FIELDS = ['name', 'address', 'accountType', 'vatRegistered'] as const;

export function createCustomer(raw: unknown): Customer {
  const body = asObject(raw, 'customer');
  rejectUnknownFields(body, CUSTOMER_FIELDS);

  const customer: Customer = {
    id: nextId('C-', customers),
    name: text(body, 'name'),
    address: text(body, 'address'),
    accountType: oneOf(body, 'accountType', ACCOUNT_TYPES),
    vatRegistered: flag(body, 'vatRegistered'),
  };

  customers.push(customer);
  persist();
  return customer;
}

export function updateCustomer(id: string, raw: unknown): Customer {
  const customer = findOrThrow(customers, id, 'customer');
  const body = asObject(raw, 'customer');
  rejectUnknownFields(body, CUSTOMER_FIELDS);

  // Changing accountType silently re-rates every invoice this customer has,
  // because VAT is derived at read time rather than stored. That is the existing
  // design, not something introduced here, but it is worth knowing about.
  Object.assign(
    customer,
    patch(body, 'name', () => text(body, 'name')),
    patch(body, 'address', () => text(body, 'address')),
    patch(body, 'accountType', () => oneOf(body, 'accountType', ACCOUNT_TYPES)),
    patch(body, 'vatRegistered', () => flag(body, 'vatRegistered')),
  );

  persist();
  return customer;
}

export function deleteCustomer(id: string): void {
  const customer = findOrThrow(customers, id, 'customer');

  const invoiceCount = invoices.filter((invoice) => invoice.customerId === id).length;
  if (invoiceCount > 0) {
    throw conflict(`customer has ${invoiceCount} invoice(s); delete or reassign them first`);
  }
  const orderCount = workOrders.filter((order) => order.customerId === id).length;
  if (orderCount > 0) {
    throw conflict(`customer has ${orderCount} work order(s); delete or reassign them first`);
  }

  customers.splice(customers.indexOf(customer), 1);
  persist();
}

// --- invoices ---------------------------------------------------------------

const INVOICE_FIELDS = ['customerId', 'issued', 'lines', 'source', 'paid'] as const;

function requireCustomer(id: string): void {
  if (!customers.some((customer) => customer.id === id)) {
    throw badRequest(`no such customer: ${id}`);
  }
}

export function createInvoice(raw: unknown): Invoice {
  const body = asObject(raw, 'invoice');
  rejectUnknownFields(body, INVOICE_FIELDS);

  const customerId = text(body, 'customerId');
  requireCustomer(customerId);

  const invoice: Invoice = {
    id: nextId('INV-', invoices),
    customerId,
    issued: calendarDate(body, 'issued'),
    lines: lineItems(body, 'lines'),
    source: 'source' in body ? oneOf(body, 'source', INVOICE_SOURCES) : 'WEB',
    paid: 'paid' in body ? flag(body, 'paid') : false,
  };

  invoices.push(invoice);
  persist();
  return invoice;
}

export function updateInvoice(id: string, raw: unknown): Invoice {
  const invoice = findOrThrow(invoices, id, 'invoice');
  if (invoice.paid) {
    throw conflict('invoice is paid and cannot be changed');
  }

  const body = asObject(raw, 'invoice');
  rejectUnknownFields(body, INVOICE_FIELDS);

  if ('customerId' in body) requireCustomer(text(body, 'customerId'));

  Object.assign(
    invoice,
    patch(body, 'customerId', () => text(body, 'customerId')),
    patch(body, 'issued', () => calendarDate(body, 'issued')),
    patch(body, 'lines', () => lineItems(body, 'lines')),
    patch(body, 'source', () => oneOf(body, 'source', INVOICE_SOURCES)),
    patch(body, 'paid', () => flag(body, 'paid')),
  );

  persist();
  return invoice;
}

export function deleteInvoice(id: string): void {
  const invoice = findOrThrow(invoices, id, 'invoice');
  if (invoice.paid) {
    throw conflict('invoice is paid and cannot be deleted');
  }

  invoices.splice(invoices.indexOf(invoice), 1);
  persist();
}

// --- engineers --------------------------------------------------------------

const ENGINEER_FIELDS = ['name', 'skills'] as const;

export function createEngineer(raw: unknown): Engineer {
  const body = asObject(raw, 'engineer');
  rejectUnknownFields(body, ENGINEER_FIELDS);

  const engineer: Engineer = {
    id: nextId('E-', engineers),
    name: text(body, 'name'),
    skills: skillList(body, 'skills'),
  };

  engineers.push(engineer);
  persist();
  return engineer;
}

export function updateEngineer(id: string, raw: unknown): Engineer {
  const engineer = findOrThrow(engineers, id, 'engineer');
  const body = asObject(raw, 'engineer');
  rejectUnknownFields(body, ENGINEER_FIELDS);

  Object.assign(
    engineer,
    patch(body, 'name', () => text(body, 'name')),
    patch(body, 'skills', () => skillList(body, 'skills')),
  );

  persist();
  return engineer;
}

export function deleteEngineer(id: string): void {
  const engineer = findOrThrow(engineers, id, 'engineer');

  const assigned = workOrders.filter((order) => order.engineerId === id).length;
  if (assigned > 0) {
    throw conflict(`engineer is on ${assigned} work order(s); reassign them first`);
  }

  engineers.splice(engineers.indexOf(engineer), 1);
  persist();
}

// --- work orders ------------------------------------------------------------

const WORK_ORDER_FIELDS = [
  'customerId', 'address', 'requires', 'requestedAt', 'durationMinutes', 'status', 'engineerId',
] as const;

function requireEngineer(id: string): void {
  if (!engineers.some((engineer) => engineer.id === id)) {
    throw badRequest(`no such engineer: ${id}`);
  }
}

export function createWorkOrder(raw: unknown): WorkOrder {
  const body = asObject(raw, 'work order');
  rejectUnknownFields(body, WORK_ORDER_FIELDS);

  const customerId = text(body, 'customerId');
  requireCustomer(customerId);

  const order: WorkOrder = {
    id: nextId('W-', workOrders),
    customerId,
    address: text(body, 'address'),
    requires: text(body, 'requires'),
    requestedAt: instant(body, 'requestedAt'),
    durationMinutes: wholeNumber(body, 'durationMinutes', { min: 1 }),
    status: 'status' in body ? oneOf(body, 'status', WORK_ORDER_STATUSES) : 'QUEUED',
  };

  if ('engineerId' in body && body.engineerId !== undefined) {
    const engineerId = text(body, 'engineerId');
    requireEngineer(engineerId);
    order.engineerId = engineerId;
  }

  workOrders.push(order);
  persist();
  return order;
}

export function updateWorkOrder(id: string, raw: unknown): WorkOrder {
  const order = findOrThrow(workOrders, id, 'work order');
  const body = asObject(raw, 'work order');
  rejectUnknownFields(body, WORK_ORDER_FIELDS);

  if ('customerId' in body) requireCustomer(text(body, 'customerId'));
  if ('engineerId' in body && body.engineerId !== null) requireEngineer(text(body, 'engineerId'));

  Object.assign(
    order,
    patch(body, 'customerId', () => text(body, 'customerId')),
    patch(body, 'address', () => text(body, 'address')),
    patch(body, 'requires', () => text(body, 'requires')),
    patch(body, 'requestedAt', () => instant(body, 'requestedAt')),
    patch(body, 'durationMinutes', () => wholeNumber(body, 'durationMinutes', { min: 1 })),
    patch(body, 'status', () => oneOf(body, 'status', WORK_ORDER_STATUSES)),
  );

  // null clears the assignment; a string sets it.
  if ('engineerId' in body) {
    if (body.engineerId === null) {
      delete order.engineerId;
    } else {
      order.engineerId = text(body, 'engineerId');
    }
  }

  persist();
  return order;
}

export function deleteWorkOrder(id: string): void {
  const order = findOrThrow(workOrders, id, 'work order');
  workOrders.splice(workOrders.indexOf(order), 1);
  persist();
}
