# JOB A: VAT is missing from invoices

**Raised by:** Finance (Sandra, 12 Aug)
**Queue age:** 16 days

Sandra says the totals we send out do not have VAT on them and she has been adding
it by hand in a spreadsheet since the web front end went live. Accounts want it on
the invoice itself.

She also mentioned something about not all of it being vatable but I did not write
down what she said. Her email is in the shared mailbox somewhere.

Needs to show on the invoice and in the outstanding balance.

## Resolution (2026-09-01)

Applied policy (user-confirmed, standing in for Sandra's uncaptured rules —
**Finance must confirm this is correct**): SERVICE lines (engineer work) carry
20% VAT; SUPPLY lines (metered water) are zero-rated; the LEGACY_PAPER postage
surcharge is zero-rated and not treated as a SERVICE line, so historic paper
invoices keep reconciling against their original totals. VAT is computed once
per invoice, on the SERVICE subtotal, rounded half up to the penny via
`percentOf` in `src/shared/money.ts`.

Caveat: Sandra's actual VAT rules were never captured — this is an assumption,
not a confirmed spec. Finance must confirm both the rate(s) and the rounding
convention on a per-invoice basis before this is relied on for real returns.

`totalFor()` now returns `{ net, vat, total }`; `total` is VAT-inclusive and
flows automatically into the `/invoices/:id` response and into
`outstandingFor()`'s balance, since both were already built on `totalFor()`'s
result.
