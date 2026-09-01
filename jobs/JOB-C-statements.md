# JOB C: customers want a statement, not four invoices

**Raised by:** Trelawney Foods, via account management (5 Aug)
**Queue age:** 23 days

Their finance team asked for "a statement like our other suppliers send" because
they are reconciling four separate invoice PDFs by hand every quarter.

We do not have anything like this. The front end team say they can render whatever
we give them as long as it comes off an endpoint.

Nobody has agreed what goes on it.

## Resolution (2026-09-01)

Added `GET /customers/:id/statement`, implemented in `src/invoices/statement.ts`
(`statementFor`) and wired into `src/server.ts` next to the existing
`/customers/:id/invoices` route. Returns 404 `{ error: 'no such customer' }`
for an unknown customer id.

Decided shape: one line per invoice (sorted by issued date ascending) plus
summary totals and the outstanding balance, matching "a statement like our
other suppliers send":

```
{
  customerId, customerName, address, generatedAt,
  lines: [{ invoiceId, issued, net, vat, total, paid }, ...],
  totals: { net, vat, total, outstanding },
  display: { total, outstanding }   // formatted as '£1,234.56'
}
```

`totals` and `outstanding` are computed by reusing `totalFor`/`outstandingFor`
from `src/invoices/calc.ts`, so the statement stays consistent with VAT logic
and does not reimplement any arithmetic.

Caveat: these fields were chosen by us today as a reasonable default, not
signed off by Trelawney or account management. Before this is presented to
Trelawney (or any customer) as final, account management should confirm the
statement actually contains what they need — e.g. whether they want a running
balance per line, a statement period/date range, or PDF-style formatting
beyond the fields listed here.
