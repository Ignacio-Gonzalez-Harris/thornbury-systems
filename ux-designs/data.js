/* Thornbury Systems — prototype data layer.
   Mirrors src/db.ts, src/invoices/calc.ts, src/invoices/statement.ts,
   src/shared/money.ts, src/shared/dates.ts, src/scheduling/dispatch.ts,
   src/scheduling/slots.ts as merged in PR #1.

   Every figure in the prototypes is COMPUTED from this file, not typed in,
   so the numbers match the real API. */

var CUSTOMERS = [
  { id: 'C-1001', name: 'Mrs J Whitcombe',     address: '14 Ashfield Row, Bristol',           accountType: 'DOMESTIC',   vatRegistered: false },
  { id: 'C-1002', name: 'Trelawney Foods Ltd', address: 'Unit 6, Severnside Park, Avonmouth', accountType: 'COMMERCIAL', vatRegistered: true  },
  { id: 'C-1003', name: 'Dr A Kowalski',       address: '2 Bell Lane, Thornbury',             accountType: 'DOMESTIC',   vatRegistered: false },
  { id: 'C-1004', name: 'Severn Vale Academy', address: 'Gloucester Road, Thornbury',         accountType: 'COMMERCIAL', vatRegistered: true  }
];

var INVOICES = [
  { id: 'INV-9001', customerId: 'C-1001', issued: '2026-07-01', source: 'WEB',   paid: true,  lines: [
    { description: 'Metered supply, Q2', quantity: 41,   unitPence: 218,  kind: 'SUPPLY' },
    { description: 'Standing charge',    quantity: 1,    unitPence: 2400, kind: 'SUPPLY' } ] },
  { id: 'INV-9002', customerId: 'C-1002', issued: '2026-07-01', source: 'BATCH', paid: false, lines: [
    { description: 'Metered supply, Q2',   quantity: 1120, unitPence: 195,  kind: 'SUPPLY' },
    { description: 'Standing charge',      quantity: 1,    unitPence: 9600, kind: 'SUPPLY' },
    { description: 'Backflow device test', quantity: 2,    unitPence: 8500, kind: 'SERVICE' } ] },
  { id: 'INV-9003', customerId: 'C-1003', issued: '2026-07-01', source: 'WEB',   paid: false, lines: [
    { description: 'Metered supply, Q2', quantity: 33, unitPence: 218,   kind: 'SUPPLY' },
    { description: 'Standing charge',    quantity: 1,  unitPence: 2400,  kind: 'SUPPLY' },
    { description: 'Emergency call out', quantity: 1,  unitPence: 14000, kind: 'SERVICE' } ] },
  { id: 'INV-9004', customerId: 'C-1004', issued: '2026-04-01', source: 'BATCH', paid: true,  lines: [
    { description: 'Metered supply, Q1', quantity: 2840, unitPence: 195,  kind: 'SUPPLY' },
    { description: 'Standing charge',    quantity: 1,    unitPence: 9600, kind: 'SUPPLY' } ] }
];

var ENGINEERS = [
  { id: 'E-01', name: 'Dean Prosser', skills: ['METER', 'LEAK'] },
  { id: 'E-02', name: 'Ify Nwosu',    skills: ['METER', 'BACKFLOW', 'LEAK'] },
  { id: 'E-03', name: 'Ryan Betts',   skills: ['LEAK'] }
];

var WORK_ORDERS = [
  { id: 'W-5001', customerId: 'C-1001', address: '14 Ashfield Row, Bristol',           requires: 'METER',    requestedAt: '2026-09-02T08:00:00Z', durationMinutes: 60, status: 'QUEUED' },
  { id: 'W-5002', customerId: 'C-1001', address: '14 ashfield row, bristol',           requires: 'LEAK',     requestedAt: '2026-09-02T08:30:00Z', durationMinutes: 90, status: 'QUEUED' },
  { id: 'W-5003', customerId: 'C-1002', address: 'Unit 6, Severnside Park, Avonmouth', requires: 'BACKFLOW', requestedAt: '2026-09-02T09:00:00Z', durationMinutes: 45, status: 'QUEUED' },
  { id: 'W-5004', customerId: 'C-1003', address: '2 Bell Lane, Thornbury',             requires: 'LEAK',     requestedAt: '2026-09-02T13:00:00Z', durationMinutes: 60, status: 'QUEUED' },
  { id: 'W-5005', customerId: 'C-1004', address: 'Gloucester Road, Thornbury',         requires: 'METER',    requestedAt: '2026-09-02T13:30:00Z', durationMinutes: 30, status: 'QUEUED' },
  { id: 'W-5006', customerId: 'C-1002', address: 'Unit 6, Severnside Park, Avonmouth', requires: 'BACKFLOW', requestedAt: '2026-09-02T23:30:00Z', durationMinutes: 45, status: 'QUEUED' }
];

/* PRD 3.1: the duplicate van is still live. A van already DISPATCHED this
   morning is invisible to the check, because dispatch() skips non-QUEUED
   orders and only compares against what it planned in THIS call. */
function scenarioVanAlreadyOut() {
  return WORK_ORDERS.map(function (w) {
    return w.id === 'W-5001' ? Object.assign({}, w, { status: 'DISPATCHED', engineerId: 'E-01' }) : Object.assign({}, w);
  });
}

/* ---------- money (src/shared/money.ts) ---------- */
var money = {
  format: function (p) {
    var neg = p < 0, abs = Math.abs(p);
    return (neg ? '-' : '') + '£' + Math.floor(abs / 100).toLocaleString('en-GB') + '.' + String(abs % 100).padStart(2, '0');
  },
  sum: function (xs) { return xs.reduce(function (a, b) { return a + b; }, 0); },
  percentOf: function (p, pct) { return Math.round((p * pct) / 100); }
};

/* ---------- dates (src/shared/dates.ts) — store UTC, show Europe/London ---------- */
var UK = 'Europe/London';
var fmtTime = new Intl.DateTimeFormat('en-GB', { timeZone: UK, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
var fmtDate = new Intl.DateTimeFormat('en-GB', { timeZone: UK, year: 'numeric', month: '2-digit', day: '2-digit' });
var fmtLong = new Intl.DateTimeFormat('en-GB', { timeZone: UK, weekday: 'long', day: 'numeric', month: 'long' });
var fmtShort = new Intl.DateTimeFormat('en-GB', { timeZone: UK, weekday: 'short', day: 'numeric', month: 'short' });

function dateKey(d) {
  var p = fmtDate.formatToParts(d);
  function g(t) { return p.find(function (x) { return x.type === t; }).value; }
  return g('year') + '-' + g('month') + '-' + g('day');
}
function slotTime(d) { return fmtTime.format(d); }
function sameDay(a, b) { return dateKey(a) === dateKey(b); }
function ukMinutes(d) { var t = fmtTime.format(d).split(':'); return (+t[0]) * 60 + (+t[1]); }

/* ---------- invoice totals (src/invoices/calc.ts) ---------- */
var STANDARD_VAT_PERCENT = 20;
function lineTotal(l) { return l.quantity * l.unitPence; }
function legacySurcharge(inv) { return inv.source === 'LEGACY_PAPER' ? 150 : 0; }

/* SERVICE (engineer work) is standard-rated for everyone. SUPPLY (metered
   water) is zero-rated for DOMESTIC, standard-rated for COMMERCIAL.
   PRD D1: this rule is an INFERENCE. Finance has not confirmed it. */
function isVatable(line, customer) {
  return line.kind === 'SERVICE' || customer.accountType === 'COMMERCIAL';
}

function totalFor(invoice, customer) {
  var net = money.sum(invoice.lines.map(lineTotal)) + legacySurcharge(invoice);
  var vatable = money.sum(invoice.lines.filter(function (l) { return isVatable(l, customer); }).map(lineTotal));
  var vat = money.percentOf(vatable, STANDARD_VAT_PERCENT);
  return { net: net, vat: vat, total: net + vat, vatable: vatable, zeroRated: net - vatable };
}

function customerFor(id) { return CUSTOMERS.find(function (c) { return c.id === id; }); }
function invoicesFor(id) { return INVOICES.filter(function (i) { return i.customerId === id; }); }
function outstandingFor(id) {
  var c = customerFor(id);
  return money.sum(invoicesFor(id).filter(function (i) { return !i.paid; }).map(function (i) { return totalFor(i, c).total; }));
}

/* ---------- statement (src/invoices/statement.ts) ---------- */
function statementFor(customer) {
  var rows = invoicesFor(customer.id)
    .sort(function (a, b) { return a.issued.localeCompare(b.issued) || a.id.localeCompare(b.id); })
    .map(function (i) {
      return Object.assign({ id: i.id, issued: i.issued, paid: i.paid, source: i.source, lines: i.lines }, totalFor(i, customer));
    });
  return {
    customer: customer,
    invoices: rows,
    totals: {
      net: money.sum(rows.map(function (r) { return r.net; })),
      vat: money.sum(rows.map(function (r) { return r.vat; })),
      invoiced: money.sum(rows.map(function (r) { return r.total; })),
      paid: money.sum(rows.filter(function (r) { return r.paid; }).map(function (r) { return r.total; })),
      outstanding: money.sum(rows.filter(function (r) { return !r.paid; }).map(function (r) { return r.total; }))
    }
  };
}

/* ---------- dispatch (src/scheduling/dispatch.ts) ---------- */
function canonicalAddress(a) {
  return a.trim().toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function dispatchPlan(orders) {
  var planned = [], skipped = [];
  orders.forEach(function (order) {
    if (order.status !== 'QUEUED') return;
    var when = new Date(order.requestedAt);
    var clash = planned.find(function (a) {
      return canonicalAddress(a.address) === canonicalAddress(order.address) && sameDay(new Date(a.startsAt), when);
    });
    if (clash) { skipped.push({ order: order, reason: 'address already visited that UK day', clashWith: clash.workOrderId }); return; }
    var engineer = ENGINEERS.find(function (e) { return e.skills.indexOf(order.requires) !== -1; });
    if (!engineer) { skipped.push({ order: order, reason: 'no engineer holds skill ' + order.requires }); return; }
    planned.push({
      workOrderId: order.id, engineerId: engineer.id, address: order.address,
      startsAt: order.requestedAt, requires: order.requires,
      durationMinutes: order.durationMinutes, customerId: order.customerId
    });
  });
  return { planned: planned, skipped: skipped };
}

/* PRD 3.1: an order already DISPATCHED to the same address on the same UK day
   is invisible to dispatch(). Detect it so a UI can show the second van. */
function duplicateVisits(orders, plan) {
  var out = [];
  plan.forEach(function (a) {
    orders.forEach(function (o) {
      if (o.id === a.workOrderId) return;
      if (o.status === 'QUEUED') return;
      if (canonicalAddress(o.address) !== canonicalAddress(a.address)) return;
      if (!sameDay(new Date(o.requestedAt), new Date(a.startsAt))) return;
      out.push({ planned: a.workOrderId, existing: o.id, address: a.address, sameEngineer: o.engineerId === a.engineerId });
    });
  });
  return out;
}

/* dispatch() picks the first skilled engineer with no availability check, so
   one engineer can end up holding overlapping jobs. */
function overlaps(plan) {
  var bad = [];
  ENGINEERS.forEach(function (e) {
    var mine = plan.filter(function (a) { return a.engineerId === e.id; })
      .sort(function (a, b) { return a.startsAt.localeCompare(b.startsAt); });
    for (var i = 1; i < mine.length; i++) {
      var prevEnd = new Date(new Date(mine[i - 1].startsAt).getTime() + mine[i - 1].durationMinutes * 60000);
      if (new Date(mine[i].startsAt) < prevEnd) {
        bad.push({ engineerId: e.id, a: mine[i - 1].workOrderId, b: mine[i].workOrderId });
      }
    }
  });
  return bad;
}

/* ---------- slots (src/scheduling/slots.ts) ---------- */
var WINDOW_PADDING_MINUTES = 60;
function slotFor(order) {
  var start = new Date(order.requestedAt);
  var from = new Date(start.getTime() - WINDOW_PADDING_MINUTES * 60000);
  var to = new Date(start.getTime() + (order.durationMinutes + WINDOW_PADDING_MINUTES) * 60000);
  return {
    workOrderId: order.id,
    window: slotTime(from) + ' to ' + slotTime(to),
    from: slotTime(from), to: slotTime(to),
    date: dateKey(start),
    longDate: fmtLong.format(start),
    shortDate: fmtShort.format(start),
    utc: order.requestedAt,
    /* PRD 3.3: "23:30 to 02:15" reads as an end before the start. */
    rollsOver: dateKey(from) !== dateKey(to),
    /* PRD JOB D: the stored UTC day and the UK-local day are not the same day. */
    utcDayDiffers: dateKey(start) !== order.requestedAt.slice(0, 10)
  };
}

function engineerFor(id) { return ENGINEERS.find(function (e) { return e.id === id; }); }
function orderFor(id) { return WORK_ORDERS.find(function (w) { return w.id === id; }); }

/* ---------- support queue (jobs/*.md) + PRD status ---------- */
var JOBS = [
  { id: 'JOB-A', title: 'VAT is missing from invoices',               by: 'Finance (Sandra)', raised: '12 Aug', age: 16, state: 'SHIPPED',   caveat: 'The VAT rule is inferred, not sourced. PRD D1.' },
  { id: 'JOB-B', title: 'Two vans to the same house',                 by: 'Support (Marcus)', raised: '21 Aug', age: 7,  state: 'PARTIAL',   caveat: 'Only punctuation matching shipped. Duplicate still reproducible. PRD 3.1.' },
  { id: 'JOB-C', title: 'Customers want a statement, not 4 invoices', by: 'Trelawney Foods',  raised: '5 Aug',  age: 23, state: 'SHIPPED',   caveat: 'No period, no opening/closing balance. Shape never agreed. PRD 3.4 / D2.' },
  { id: 'JOB-D', title: 'A customer was given the wrong day',         by: 'Support (Marcus)', raised: '26 Aug', age: 2,  state: 'SHIPPED',   caveat: 'Root cause fixed. Midnight rollover and the 2027 holiday cliff remain. PRD 3.2 / 3.3.' }
];

/* PRD 4 — business rules on main that nobody at Thornbury has confirmed. */
var OPEN_DECISIONS = [
  { id: 'D1', q: 'Is SUPPLY zero-rated for DOMESTIC and standard-rated for COMMERCIAL?', who: 'Finance (Sandra)', state: 'Unsourced inference — shipped' },
  { id: 'D2', q: 'What actually goes on a statement? Period, opening/closing balance?',   who: 'Account management', state: 'Never agreed' },
  { id: 'D3', q: 'Should the LEGACY_PAPER 150p surcharge sit outside the VAT base?',      who: 'Finance', state: 'Unsourced inference — shipped' },
  { id: 'D4', q: 'Is vatRegistered dead, or the intended discriminator?',                 who: 'Finance', state: 'Unsourced inference — shipped' }
];

var API_ROUTES = [
  'GET /customers', 'GET /customers/:id', 'GET /customers/:id/invoices',
  'GET /customers/:id/statement', 'GET /invoices/:id',
  'GET /work-orders', 'GET /dispatch', 'GET /slots'
];

/* Shared helpers the prototypes use. */
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
function el(sel) { return document.querySelector(sel); }
function els(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
