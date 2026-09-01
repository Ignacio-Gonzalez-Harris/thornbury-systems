# JOB B: two vans to the same house

**Raised by:** Support (Marcus, 21 Aug)
**Queue age:** 7 days

Mrs Whitcombe had two engineers turn up on the same morning, half an hour apart,
one for the meter and one for the leak. She was not happy and it is not the first
time. Marcus says it happens most weeks.

There is a check in the dispatcher that is supposed to stop this. Either it is not
running or it is not catching it.

The addresses in our system are typed in by whoever takes the call.

## Resolution (2026-09-01)

The one-visit-per-address-per-day check in `alreadyVisiting()` (src/scheduling/dispatch.ts)
was always running — it just compared addresses letter-for-letter with `===`. Because
addresses are hand-typed by whoever takes the call, the same house can be entered with
different capitalisation, spacing or punctuation (the live repro: W-5001 '14 Ashfield Row,
Bristol' vs W-5002 '14 ashfield row, bristol'), so the check silently missed the duplicate.

Fix: both sides of the comparison are now normalised (lowercased, punctuation stripped,
whitespace collapsed and trimmed) before comparing, via a new `normaliseAddress()` helper.

Deliberately NOT done:
- No Rd/Road (or similar abbreviation) expansion — considered and deferred.
- No customer-id based matching — considered and deferred.

Still out of scope (pre-existing, not part of this fix): dispatch does not check whether
an engineer is double-booked across two different addresses at overlapping times.
