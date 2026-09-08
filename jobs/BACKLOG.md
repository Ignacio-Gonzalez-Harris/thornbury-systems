# Backlog

The deferral tracker. GitHub Issues are disabled on this repo, so this file is
where "out of scope" and "file a ticket" notes point instead. One item per
thing, a stable id, and enough context to pick it up cold.

Do not delete an item when it ships — close it out with a one-line note and a
PR reference so the id stays a working link for anything that pointed at it.

---

## TB-01: stable address key on WorkOrder

`WorkOrder` addresses are free text, typed in by whoever takes the call.
Dispatch matching (`canonicalAddress()`) has already been through one round of
normalisation fixes and will need another the next time punctuation or
abbreviation trips it up. String-matching free-text addresses keeps leaking
however good the normalisation gets — the fix is a stable key (postcode or
UPRN, the UK's unique property reference number) stored on the work order
itself, not a smarter string comparison.

From PRD 3.1.

## TB-02: gov.uk bank-holiday feed

`BANK_HOLIDAYS` in `src/shared/dates.ts` is a hardcoded, 2026-only list.
On 1 January 2027 `isWorkingDay()` starts returning `true` for every bank
holiday, silently, with no test failure — the same failure mode as W-4412,
output that looks correct and is wrong for part of the year. A coverage test
now fails once the list stops covering the current year, which catches the
symptom; replacing the hardcoded list with the gov.uk bank-holiday feed is the
real fix.

From PRD 3.2.

## TB-03: SQL Server migration

`src/db.ts` is in-memory arrays standing in for SQL Server tables, and
`src/store.ts` adds a JSON snapshot on top so writes survive a restart.
Neither is concurrency-safe — one process, one file, last write wins, and
that is the first thing that breaks if a second process ever runs. Replacing
both with a real SQL Server connection is the intended end state.

From PRD 6.

## TB-04: CI, plus a type-check step

There is no CI on this repo. `--experimental-strip-types` runs TypeScript
directly with no build step, which means no type-checking either — an arity
or type error reaches production as a runtime crash instead of a build
failure. Related hazard, already seen once: before the handler-level catch
was added to `createServer`, an uncaught route error hung the request instead
of failing it, the run went past its timeout, and it exited 0 — a failure the
build box would have called a pass. CI needs to catch both classes: the
crash-shaped one (type-check) and the hang-shaped one (a real timeout that
fails the run instead of exiting clean).

From PRD 2 and 6.

## TB-05: contributor guide

The README says it is missing, and it is. CLAUDE.md now exists (added in
docs(agents) #4) and covers agent-facing instructions, but there is still no
guide for a human contributor — how to run things locally, the two invariants
(pence, UTC-stored/UK-local-displayed), and the strip-types gotchas in PRD
5.5 that were found the hard way. Priya, who wrote most of the scheduling
side, left in March without writing any of this down.

From PRD 6.

## TB-06: dispatch() can double-book an engineer

PRD 3.1's reproduction against `main` — Mrs Whitcombe, a `DISPATCHED` meter
job at 08:00 and a `QUEUED` leak job at 08:30, same address — showed
`dispatch()` assigning **E-01, the same engineer already on the 08:00 job**,
to the second visit. The address half of this bug is fixed (dispatch now
considers all same-day work orders regardless of status, not just the ones
built during the current call). The engineer half is untouched, because the
ticket's stated acceptance criterion only covers the address: "given a
`DISPATCHED` order at address X on day D, `dispatch()` plans no further visit
to X on D" says nothing about who it assigns. This is not a regression from
that fix — the same hole existed before it.

From PRD 3.1.

## TB-07: statement shape

`GET /customers/:id/statement` ships with no period filter, no opening or
closing balance, and raw pence instead of the `format()` display strings
already used on the other money-bearing routes. Trelawney reconcile
quarterly and asked for something they can reconcile against; the current
shape cannot do that. Add `?from=&to=` for the period, opening/closing
balance, and run the money fields through `format()` from `shared/money.ts`.

**Blocked** on decision D2 (what actually goes on the statement) with account
management — PRD 6 says do not release until that is agreed. Shipping a guess
back to the customer who complained earns a second complaint.

From PRD 3.4.

## TB-08: VAT rule sign-off with Finance

Decisions D1, D3 and D4 in PRD 4 are unsourced inferences and are already
merged on `main`:

- **D1** — is `SUPPLY` zero-rated for `DOMESTIC` and standard-rated for
  `COMMERCIAL`? What did Sandra mean by "not all of it is vatable"?
- **D3** — should the `LEGACY_PAPER` 150p postage surcharge sit outside the
  VAT base?
- **D4** — is `vatRegistered` dead, or the intended discriminator?

None of the three have been confirmed by anyone at Thornbury. Sandra's email
is still unread.

PRD 4.1 also records that, if D1 is right, the two commercial invoices in the
seed data were under-declared by **£1,582.80** combined under the old rule.
This is entirely contingent on D1 — if Finance names a different
discriminator, the number evaporates — and `db.ts` is seed data standing in
for SQL Server, not a record of invoices actually sent, so whether real
customers were under-charged is unknown from this repo.

**Do not report this to Finance as an incident.** Ask D1 first. If D1 is
confirmed, *then* ask whether production invoices carry the same treatment.

From PRD 4 and 4.1.

## TB-09: nextId() hands out invoice numbers that have already been used

`nextId()` in `src/crud.ts` derives the next id from the highest one currently
in the collection, so deleting the newest row frees its number for the next
create: delete `INV-9005` and the next `POST /invoices` is `INV-9005` again.
In a billing system a reused invoice number is a real problem — two different
documents, same reference, and the customer's copy of the first one still
exists. The fix is a monotonic counter held in the snapshot (`src/store.ts`)
rather than a scan of the live rows.

Same function, smaller: the zero-padding width is taken from the LAST matching
row it iterates rather than the widest, so a collection holding both `C-999`
and `C-1004` would pad the new id to the wrong width. Not reachable with
today's seed data; fix it while the counter is being added.

Note for whoever picks this up: `test/crud.test.ts` currently relies on the
reuse behaviour to keep created ids predictable, so the tests move with the
fix.

Found during the CRUD MVP build; not in the PRD.

## TB-10: skill names are unvalidated free text, so a typo books a job that is never dispatched

`createWorkOrder` validates `requires` with `text()` and `createEngineer`
validates `skills` with `skillList()`, and both accept any non-empty string.
Every other closed-set field in `src/crud.ts` — `accountType`, `source`,
`kind`, `status` — goes through `oneOf()` against a frozen list. `canDo()` in
`src/scheduling/dispatch.ts` is a case-sensitive `skills.includes(requires)`.

So `POST /work-orders` with `requires` of `Meter` instead of `METER` returns
201, the order appears in `GET /work-orders`, and `dispatch()` plans nothing
for it — ever. No error at write time, none at dispatch time, and the customer
is booked in the system with no van allocated. Confirmed against the running
server during review.

**Deferred rather than fixed**, because whether Thornbury's skill list is a
closed set is a business decision, not a code one. Freezing it to
`METER`/`LEAK`/`BACKFLOW` would reject a genuinely new skill at the door;
leaving it open keeps the silent failure. That needs a human answer from
whoever owns the scheduling side — and PRD 1 records that Priya, who wrote it,
left in March 2026 without writing her reasoning down.

Cheap interim option for whoever picks this up: reject a `requires` that no
engineer on file can service, with a 400 naming the known skills. That catches
the typo without freezing the list.

Found during the CRUD MVP build; not in the PRD.
