# Thornbury Systems — agent instructions

## Frontend / HTML work must follow the house design

Any agent producing frontend output — HTML, CSS, templates, components, screens,
emails, or anything a user will look at — is **led by the house design reference**,
not by its own taste.

- The canonical reference is **`ux-designs/4-brutalist-ledger.html`** (the adopted
  "brutalist ledger" flavour: high-contrast editorial, bills rendered as printed
  documents), together with the shared data it loads, `ux-designs/data.js`.
  Read both before writing any markup.
- Reuse its tokens, classes, and component markup verbatim. Match its typography,
  spacing, colour, and layout patterns rather than introducing your own.
- Do not invent a visual style and do not pull in a UI framework or theme. If the
  reference does not cover a pattern you need, extend it in its own idiom and say so
  in the PR — do not import a different look.
- Deviating from the reference needs an explicit human decision recorded on the
  ticket. A nicer idea is not a reason.
- The four rejected candidates (`1-ops-console`, `2-dispatch-dark`,
  `3-customer-portal`, `5-terminal`) were removed in PR #3 and survive only in history
  at `e177f42`. They are not style sources — do not copy from them.
