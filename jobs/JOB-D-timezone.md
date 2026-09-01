# JOB D: a customer was given the wrong day

**Raised by:** Support (Marcus, 26 Aug)
**Queue age:** 2 days

Trelawney have a late backflow test booked and the confirmation we sent them has
the wrong date on it. Marcus checked the work order and the stored time is right,
so it is what we print that is wrong.

He says this is the same thing as W-4412, which has been closed twice as cannot
reproduce. Both reports came in the summer. Nobody has managed to make it happen
in the winter, and it has never once failed on the build box.

Everything the customer sees is UK local. Everything we store is UTC. Somewhere
those two are being treated as the same thing.

## Resolution (2026-09-01)

Root cause: `formatSlotTime` rendered with `getHours()`/`getMinutes()`, which
read the machine's local timezone, not UK local — correct only on a
UK-configured machine, wrong everywhere else (and wrong on any machine during
part of the year once BST/GMT and the machine's own zone disagree). Separately,
`slots.ts` took the displayed `date` straight off the stored UTC string
(`requestedAt.slice(0, 10)`), so a request timestamped late at night UTC that
has already rolled into the next UK-local day was printed on the wrong day
(W-5006: `2026-09-02T23:30:00Z` is 00:30 on 3 Sept UK local, but printed
`2026-09-02`).

Fix: `formatSlotTime` now renders via `Intl.DateTimeFormat` pinned to
`Europe/London` (with `hourCycle: 'h23'`, not `hour12: false`, to avoid the
midnight `24:00` quirk). Added `ukDateKey(d)` for the Europe/London calendar
date (`en-CA` locale, timeZone `Europe/London`), and `sameDay`/`isWorkingDay`
(weekday and bank-holiday lookup) now both work off the UK-local calendar
instead of the machine's local calendar or the raw UTC day. `slots.ts` now
sets `date` from `ukDateKey(start)` instead of slicing the UTC string.

W-4412 was the same defect (machine-local rendering), which is why it only
ever showed up on customer machines in summer and never reproduced on the
build box (UTC/UK-agreeing zone, or checked in winter when the drift is
smaller). It is now regression-tested: `test/scheduling.test.ts` covers the
W-5006 day-rollover case and a winter (GMT) case, and `test/dates.test.ts`
covers `sameDay` across a UK-local midnight. All three run green under the
local machine's timezone, forced `TZ=UTC`, and forced `TZ=America/New_York`.
