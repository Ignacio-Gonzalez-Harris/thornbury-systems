# Thornbury Systems

Billing and job scheduling for UK water utilities. This repository is the API the
web front end talks to. The desktop product is not in here.

## Running it

No install step. Node 22.6 or newer runs the TypeScript directly.

```
npm test        # the suite
npm start       # http://localhost:4310
```

The API is no longer read-only. Alongside the eight GET routes there is now
write support:

- `POST /customers`, `PATCH /customers/:id`, `DELETE /customers/:id`
- `GET /invoices`, `POST /invoices`, `PATCH /invoices/:id`, `DELETE /invoices/:id`
- `GET /engineers`, `POST /engineers`, `PATCH /engineers/:id`, `DELETE /engineers/:id`
- `POST /work-orders`, `GET /work-orders/:id`, `PATCH /work-orders/:id`, `DELETE /work-orders/:id`

PATCH is a partial merge, not a replace. A delete that would orphan a row
(a customer with invoices, an engineer on a work order) is refused with 409
rather than cascading.

**No auth.** Anyone who can reach the port can delete a customer. That is
fine on localhost and not fine anywhere else — do not expose this service
outside a trusted network without adding a guard first.

**A paid invoice is locked.** Writes to a `paid` invoice are rejected with
409. That means an invoice marked paid by mistake cannot be un-marked
through the API — accepted deliberately as the cost of the guard.

## Persistence

Writes flush to a JSON snapshot at `data/store.json`, loaded back at boot.
It is off under the tests (they mutate the in-memory arrays directly and
expect a clean slate next run) and on for the real server. Controlled by the
`THORNBURY_STORE` environment variable — set it to point at a specific file,
or set it to an empty string to disable persistence explicitly.

## Layout

- `src/invoices` billing. Totals, balances.
- `src/scheduling` work orders, engineer dispatch, customer appointment windows.
- `src/shared` money and dates. Both are used by both sides, so changes here reach further than they look.
- `src/db.ts` the seed data. Stands in for the SQL Server tables.
- `src/store.ts` the JSON snapshot persistence layer.
- `jobs/` the support queue.
- `jobs/BACKLOG.md` the deferral tracker — everything marked out of scope or follow-up elsewhere points at an id in here.

## Notes from the team

The migration off the desktop product stalled in 2023. What you are looking at is
the half that got done.

Priya wrote most of the scheduling side and left in March. Nobody has picked it up.
If something in there looks deliberate, it probably was, but the reasoning is not
written down anywhere.

Money is in pence. Dates are stored UTC and shown UK local. Those two rules are the
only ones everybody agreed on.

There is a CLAUDE.md now, but still no contributor guide — see TB-05 in
`jobs/BACKLOG.md`. That was on Priya's list.
