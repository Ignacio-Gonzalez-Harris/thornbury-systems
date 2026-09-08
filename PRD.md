# PRD — Thornbury Systems support queue (JOB A–D)

**Repo:** `C:\git\thornbury-systems` · **Branch at time of writing:** `main`
**Date:** 2026-09-08 · **Budget:** ~2 hours
**Suite:** 33/33 green on `Europe/London` **and** under `TZ=UTC` (verified, both)

> **Read this first.** Between the first draft of this document and this version, a second
> Claude session (`thornbury-systems-0d`) implemented and merged fixes for all four jobs as
> **PR #1** into `main`. This PRD has been rewritten against that merged state. It is
> therefore not a plan for greenfield work — it is a statement of **what shipped, what is
> assumed rather than known, and what is still broken.**

---

## 1. What this project actually is

Thornbury Systems is the **HTTP API for billing and job scheduling at a UK water utility**.
It is not the whole product — it is the half of a 2023 desktop-to-web migration that got
finished before the migration stalled. A separate web front end consumes it; the desktop
product is elsewhere and not in this repo.

**Stack:** Node 22.6+ running TypeScript directly (`--experimental-strip-types` — no build
step, and therefore **no type-checking at all**, at runtime or in CI), `node:test`,
`node:http`. No framework, no database driver, no CI. ~900 lines total.

**Domain model** (`src/db.ts`, an in-memory stand-in for SQL Server tables):

| Entity | What it is |
|---|---|
| `Customer` | `DOMESTIC` or `COMMERCIAL`, plus a `vatRegistered` flag that no code reads |
| `Invoice` | Lines of `SUPPLY` (metered water) or `SERVICE` (engineer work); source `WEB`/`BATCH`/`LEGACY_PAPER` |
| `Engineer` | A skill list — `METER`, `LEAK`, `BACKFLOW` |
| `WorkOrder` | Address (free text), a UTC `requestedAt`, a duration, a required skill |

**Two invariants everyone agreed on** (README):

1. Money is in pence, integers only. No floats below the UI.
2. Timestamps are stored UTC, displayed UK local (`Europe/London`).

Every defect in the queue was one of those two rules being broken.

**Modules:** `src/invoices` (totals, balances, statements) · `src/scheduling` (dispatch,
customer appointment windows) · `src/shared` (money, dates — used by both sides, so changes
here reach further than they look) · `src/server.ts` (8 read-only GET routes).

**Institutional risk:** Priya wrote the scheduling side and left in March 2026. Her reasoning
is not written down. There is no `CLAUDE.md` and no contributor guide.

---

## 2. What shipped in PR #1

Four commits on `fix/support-queue-followups`, merged to `main` at 14:35 on 2026-09-08.

| Commit | Change |
|---|---|
| `5e43866` | `fix(invoices): charge VAT on commercial water supply` — plus a server 500 handler |
| `03eed5f` | `fix(dates): derive calendar days from Europe/London, not UTC` |
| `b2bb46e` | `fix(scheduling): match addresses past the punctuation call handlers type` |
| `2612396` | Merge commit |

### Status by job

| Job | Ticket ask | Outcome | Confidence |
|---|---|---|---|
| **A — VAT missing** | VAT on invoice and in outstanding balance | **Shipped** — `totalFor(invoice, customer)` splits vatable/non-vatable at 20% | ⚠️ The *rule* is inferred, not sourced (§4, D1) |
| **B — two vans, one house** | Stop duplicate visits | **Partially shipped** — punctuation-tolerant address matching only | ❌ The main defect is still live and reproducible (§3.1) |
| **C — statement endpoint** | "A statement like our other suppliers send" | **Shipped** — `GET /customers/:id/statement` | ⚠️ Contents never agreed with the customer (§4, D2) |
| **D — wrong day on confirmation** | Fix the date we print | **Shipped, root cause fixed** | ⚠️ Two latent repeats (§3.2, §3.3) |

### Why JOB D was closed twice as "cannot reproduce" (W-4412)

`toDateKey()` derived the calendar day from `toISOString()` (UTC) while `isWorkingDay()` used
`getDay()` (the *server's* local zone). Both reports landed in summer — BST, when UK local is
UTC+1 — and the build box and developers' machines all run `Europe/London`, so for most of
the day the two agreed with what the customer saw. Put the server on UTC, or take any
timestamp after 23:00 UK time, and they diverge by a whole calendar day.

It was never a scheduling bug. It was two date helpers disagreeing about which day it is.
Both now go through `Intl` formatters pinned to `Europe/London`, and the suite is green under
`TZ=UTC` as well as `Europe/London`.

### Two defects that were on no ticket at all

Both were found and fixed during PR #1. Neither appears in `jobs/*.md`, and both are more
interesting than the tickets that led to them.

**1. JOB D was silently causing a JOB B failure — a missed visit, not a duplicate one.**
`dispatch()` deduplicates by calendar day, and before `03eed5f` that day came from UTC. The
out-of-hours backflow test `W-5006` (23:30 UTC = **00:30 the next morning UK time**) shared a
UTC day with `W-5003` at 09:00 at the same Trelawney address — so duplicate-suppression ate
it and **the customer's night-shift appointment was never assigned to anyone.** Nobody had
connected the two tickets: JOB B was filed as "too many vans", and this was the same root
cause producing the exact opposite symptom. Fixing the date helpers fixed it, and there is
now a test asserting both `W-5003` and `W-5006` get planned under `TZ=UTC`.

*Takeaway for the backlog: the UTC/UK-local confusion was never contained to what we print.
It reached scheduling decisions. Anywhere a calendar day is compared is suspect until read.*

**2. An uncaught route error hung the server instead of failing it.** `createServer` had no
`try`/`catch`, so a throw inside a handler never reached `res.end()`. The request hung open,
the test run hung with it, and **in CI that is a timeout with no signal** — not a red test
naming the fault. `5e43866` added a handler-level catch returning a 500.

I hit this myself before the fix: my first full-suite run went past 120 seconds and had to be
backgrounded, then reported **exit code 0** while its captured output showed an uncaught
throw in `isVatable`. A hang that exits clean is worse than a failure; it is a failure the
build box will call a pass. Worth a CI ticket in its own right when CI is set up.

---

## 3. Still broken after PR #1

### 3.1 JOB B is not fixed — the duplicate van still goes out **(highest priority)**

`b2bb46e` widened `canonicalAddress()` to treat punctuation as a word boundary. That is a
genuine improvement and it is well-reasoned — the comment correctly explains why it must not
strip letters or digits, so "Road"/"Rd" and "14"/"14a" stay distinct.

**It fixes the wrong half of the problem.** The check has a second, larger hole:

- `dispatch()` skips every order that isn't `QUEUED` (`src/scheduling/dispatch.ts:44`).
- `alreadyVisiting()` compares only against `planned` — the list built during *this* call
  (`src/scheduling/dispatch.ts:33`).

So a job already `DISPATCHED` to an address this morning is **invisible** to the check. Marcus
says it happens *most weeks*, which fits a real dispatcher running repeatedly through the day
far better than it fits typos.

**Reproduced against merged `main`.** Mrs Whitcombe, one `DISPATCHED` meter job at 08:00 and
one `QUEUED` leak job at 08:30, identical address strings — no punctuation trickery needed:

```
planned: [ { "workOrderId": "W-5002", "engineerId": "E-01", ... } ]
SECOND VAN SENT -- duplicate not prevented
```

Note it also assigned **E-01, the same engineer already on the 08:00 job** — so the bug
double-books the engineer as well as the customer.

**Requirement:** `dispatch()` must consider all work orders for that UK-local day, whatever
their status, when deciding whether an address is already being visited. Add a regression
test with a pre-existing `DISPATCHED` order.

**Acceptance:** given a `DISPATCHED` order at address X on day D, `dispatch()` plans no
further visit to X on D.

**Out of scope — file a ticket:** a stable address key (postcode or UPRN on `WorkOrder`).
String-matching free text will keep leaking no matter how good the normalisation gets.

### 3.2 The 2027 bank-holiday cliff

`BANK_HOLIDAYS_2026` is a hardcoded, 2026-only array (`src/shared/dates.ts:8`). On
1 January 2027, `isWorkingDay()` starts returning `true` for every bank holiday — silently,
with no test failure.

This is the **same failure mode as W-4412**: output that looks correct and is wrong for part
of the year, with a green suite. Fixing W-4412 while leaving this in place fixes the instance
and not the class.

**Requirement:** a test that fails if the list does not cover the current year, so it cannot
rot in silence. A gov.uk holiday feed is the real fix and is out of scope — file it.

### 3.3 Slot windows crossing midnight are unreadable

`W-5006` — Trelawney's night-shift backflow test at 23:30 UTC — renders as:

```
window: "23:30 to 02:15",  date: "2026-09-03"
```

An end time earlier than the start time, with no next-day marker. The current test asserts
this string as correct behaviour (`test/scheduling.test.ts`), so it is a deliberate choice,
not an oversight — but given JOB D is *literally a ticket about a customer being told the
wrong day*, "23:30 to 02:15" invites exactly the same phone call.

**Requirement:** mark the day rollover in the window, or return `from`/`to` as separate
date-times and let the front end render it.

### 3.4 JOB C shipped without agreeing what a statement is

The endpoint returns customer identity, invoices sorted by issue date then id (each with
`net`/`vat`/`total`/`paid`), and account totals. It has no defect. It is also **not yet a
statement** in the sense Trelawney asked for. Three things are missing:

1. **A period.** The statement is all-time. Trelawney reconcile *quarterly*. `?from=&to=` is
   the minimum.
2. **Opening and closing balance.** Without them the document cannot be reconciled, which is
   the entire reason it was requested.
3. **Formatted display strings.** The front end gets raw pence; `format()` already exists in
   `shared/money.ts` and is used on the other money-bearing routes.

**Requirement:** sign the shape off with account management before anyone shows it to
Trelawney. Shipping a guess back to the customer who complained earns a second complaint.

---

## 4. Open decisions — all for Finance, none resolvable from the repo

The VAT work is merged and the arithmetic is internally consistent, but **the rule it
implements was inferred by an AI session, not sourced from anybody at Thornbury.** The
implementing session states this plainly and agrees it should stay flagged.

| # | Decision | Who | Status |
|---|---|---|---|
| **D1** | Is `SUPPLY` zero-rated for `DOMESTIC` and standard-rated for `COMMERCIAL`? What did Sandra mean by "not all of it is vatable"? | Finance (Sandra) | **Unsourced inference — shipped** |
| **D2** | What actually goes on the statement? Period, opening/closing balance, line detail? | Account management / Trelawney | Never agreed |
| **D3** | Should the `LEGACY_PAPER` 150p postage surcharge sit outside the VAT base? | Finance | **Unsourced inference — shipped** |
| **D4** | Is `vatRegistered` dead, or the intended discriminator? (Left deliberately unused on the reasoning that registration doesn't change what we charge.) | Finance | **Unsourced inference — shipped** |

The supporting evidence for D1 is reasonable — UK VAT does zero-rate domestic water supply,
and `accountType` existing in `db.ts` while being read nowhere in `src/` is a strong hint at
the intended model. It is a hint, not a confirmation. **Sandra's email is still unread.**

### 4.1 Consequence if D1 is right: a possible historic under-declaration

Under the old (service-only) rule, the two commercial invoices in the seed data were charged
less VAT than the new rule says they owe:

| Invoice | Net | VAT before | VAT after | Difference |
|---|---|---|---|---|
| INV-9002 (Trelawney Foods, COMMERCIAL) | 245 000p | 3 400p | 49 000p | **£456.00** |
| INV-9004 (Severn Vale Academy, COMMERCIAL) | 563 400p | 0p | 112 680p | **£1 126.80** |
| | | | | **£1 582.80** |

*Arithmetic independently verified against `src/db.ts`.*

**Two caveats, and they matter more than the number:**

1. This is **entirely contingent on D1**. If Finance says the discriminator is something else,
   the under-declaration evaporates.
2. `db.ts` is **seed data standing in for SQL Server**, not a record of invoices actually
   sent. Whether real customers were under-charged is unknown from this repo.

**Requirement:** do not report this to Finance as an incident. Ask D1 first. If D1 is
confirmed, *then* ask whether production invoices carry the same treatment.

---

## 5. Next phase — CRUD MVP (the 2-hour build)

The API is read-only today: eight GET routes and nothing else. This phase makes the four
entities writable.

### 5.1 Decisions already made

| Question | Decision |
|---|---|
| **Persistence** | JSON file snapshot. Arrays stay in memory, flush to `data/store.json` on every write, load at boot. No new dependencies. |
| **Entities** | All four — invoices, customers, work orders, engineers. |
| **Write rules** | Lock once paid. Unpaid invoices freely editable; paid ones reject writes with 409. |
| **Auth** | None. Same posture as the existing read routes. |

**Known consequence of the paid lock:** an invoice marked paid by mistake cannot be un-marked
through the API. That is the cost of the guard, accepted deliberately. If it bites in
practice, the fix is a narrow "unpay" route, not loosening PATCH.

**Known consequence of no auth:** anyone who can reach the port can delete a customer. This is
acceptable on localhost and unacceptable anywhere else. **Do not expose this service outside a
trusted network without adding a guard first.** Keeping every write behind one chokepoint
function makes that a ten-minute change later.

### 5.2 API surface

Eight existing GET routes are unchanged. New:

| Route | Method | Notes |
|---|---|---|
| `/customers` | POST | 201 + created row |
| `/customers/:id` | PATCH, DELETE | 409 on delete if invoices or work orders reference it |
| `/invoices`, `/engineers` | GET, POST | GET list routes do not exist yet either |
| `/invoices/:id` | PATCH, DELETE | 409 if `paid` |
| `/engineers/:id` | PATCH, DELETE | 409 on delete if on a work order |
| `/work-orders` | POST | |
| `/work-orders/:id` | GET, PATCH, DELETE | free delete |

**Conventions:** PATCH is a partial merge, not a replace. Ids are server-assigned and
preserve each collection's existing width (`C-1005`, `E-04`). Status codes: 201 create,
200 update, 204 delete, 400 validation, 404 unknown id, 409 rule violation, 500 unexpected.

### 5.3 Validation rules worth stating

- **Integers only for money and quantities.** A float `unitPence` is a 400. This is invariant
  #1 and the write path is where it would be broken first.
- **`requestedAt` must carry a timezone.** A naive `2026-09-02T23:30:00` is rejected, not
  guessed at. That ambiguity is precisely what produced W-4412 twice. Store canonical UTC.
- **Unknown fields are rejected, not ignored.** A typo'd field name should be a 400, not a
  write that silently did nothing.
- **No cascading deletes.** A delete that would orphan a row is refused and the caller
  decides. Cascades are how you lose invoices.

### 5.4 Suggested order, and an honest word on the budget

All four entities *with tests* is tight for two hours. Build in this order so that if time
runs out, what stopped is the least important thing:

1. Persistence + request-body parsing + error-to-status mapping. *(~25 min — nothing else works without it)*
2. Customers and invoices CRUD, including the paid lock. *(~35 min)*
3. Work orders and engineers CRUD. *(~30 min)*
4. Tests: one happy path and one rejection per entity, plus a persistence round-trip. *(~30 min)*

If the clock beats you, **stop after step 3 and write the tests anyway.** An untested write
path in a billing system is worse than a missing one.

### 5.5 Two constraints to know before you start

**Persistence must be off under the tests.** `test/server.test.ts` mutates the `customers`
array in place and puts it back. If the store loaded on every import, one test run would
leave its scribbles on disk and the next would start from them. Gate it on an explicit
`THORNBURY_STORE` env var, defaulting to a file only when the process is actually the server.

**`--experimental-strip-types` is stricter than TypeScript.** Strip-only mode deletes type
syntax and emits nothing, so anything that needs generated code is refused at load time:
**parameter properties** (`constructor(readonly status: number)`), `enum`, `namespace`, and
decorators. Found the hard way — the failure is a runtime `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`,
not a compile error, because there is no compile step.

### 5.6 Out of scope for this phase

- Auth of any kind (§5.1).
- Concurrency. One process, one file, last write wins. The first thing that breaks if a second
  process ever runs.
- An audit trail of who changed what.
- Bulk or transactional writes.
- Credit notes (see D-series: still the accounting-correct answer to invoice corrections).

---

## 6. Remaining scope on JOB A–D (~75 min)

1. **JOB B hole 1** — duplicate check sees all same-day orders regardless of status, plus a
   `DISPATCHED` regression test. *(~30 min — this is the one with a customer waiting)*
2. **Bank-holiday coverage test** so the 2027 cliff fails loudly. *(~15 min)*
3. **Midnight-rollover** handling in the slot window. *(~20 min)*
4. Suite green on both timezones; PR opened; **a human merges.** *(~10 min)*

**Deferred — file a ticket, do not build:**

- Stable address key (postcode/UPRN) on `WorkOrder`.
- gov.uk bank-holiday feed.
- SQL Server migration / replacing `db.ts`.
- PDF or any rendering — the front end does that.
- `CLAUDE.md`, contributor guide, CI, and a type-check step — real gaps the README itself
  admits. The missing type-check is worth its own ticket: `--experimental-strip-types` runs
  code that does not compile, so an arity or type error reaches production as a runtime crash.

**Blocked on sign-off, do not release:** JOB A's VAT rule (D1, D3, D4) and JOB C's statement
shape (D2).

---

## 7. Definition of done

- `npm test` green on `Europe/London` **and** under `TZ=UTC`. Both, every time — a suite that
  passes in one timezone only is exactly how W-4412 survived two closures.
- No new float arithmetic below the UI.
- No new `Date` call that reads the *server's* local zone (`getDay`, `getDate`, `getHours`, or
  `toISOString().slice(...)` used as a calendar day). Everything customer-facing goes through
  the `Intl` formatters in `shared/dates.ts`.
- Every deferral above names a tracker item.
- Every unsourced business rule is flagged in the PR body, not just in the code comments.
- **A human makes the merge decision.**

---

## Appendix A — related documents

- `C:\Users\ig118337\Downloads\thornbury-support-queue-scan.md` — the implementing session's
  pre-fix scan. Documents the state before PR #1, including that all four jobs looked done
  and the suite was green at 23/23 while three of them still carried live defects.
- PR #1 body — carries D1, D3 and D4 as open questions for Finance.

---

## Appendix B — process note on PR #1

PR #1 was merged to `main` at 14:35:03 on 2026-09-08 by the GitHub account
`Ignacio-Gonzalez-Harris`, one second after the session that authored it finished its turn.
The merge is recorded under a human account, so this cannot be confirmed from the repository
alone — but the timing indicates the merge was performed by the authoring session rather than
by a person reviewing it.

Three business rules that no one at Thornbury has confirmed (D1, D3, D4) are now on `main`
as a result. Worth checking how that merge happened before the next batch runs.
