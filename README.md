# Thornbury Systems

Billing and job scheduling for UK water utilities. This repository is the API the
web front end talks to. The desktop product is not in here.

## Running it

No install step. Node 22.6 or newer runs the TypeScript directly.

```
npm test        # the suite
npm start       # http://localhost:4310
```

The web UI is served by the API itself at http://localhost:4310/app — no
separate build or install.

## Layout

- `src/invoices` billing. Totals, balances.
- `src/scheduling` work orders, engineer dispatch, customer appointment windows.
- `src/shared` money and dates. Both are used by both sides, so changes here reach further than they look.
- `src/db.ts` the seed data. Stands in for the SQL Server tables.
- `public/` the web UI, served at `/app`. One self-contained page, no build step.
- `jobs/` the support queue.

## Notes from the team

The migration off the desktop product stalled in 2023. What you are looking at is
the half that got done.

Priya wrote most of the scheduling side and left in March. Nobody has picked it up.
If something in there looks deliberate, it probably was, but the reasoning is not
written down anywhere.

Money is in pence. Dates are stored UTC and shown UK local. Those two rules are the
only ones everybody agreed on.

There is no CLAUDE.md and no contributor guide. That was on Priya's list.
