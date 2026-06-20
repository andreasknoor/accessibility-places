<!-- Keep this concise. Delete sections that don't apply. -->

## What & why


## Accessibility checklist (WCAG — see docs/wcag-accessibility-plan.md)

Tick what applies; strike through (`~~…~~`) what is genuinely N/A for this change.

- [ ] New/changed interactive elements are reachable and operable by **keyboard** (Tab/Enter/Space/Esc), with a visible focus style.
- [ ] Icon-only buttons and inputs have an **accessible name** (`aria-label`/`aria-labelledby` or associated `<label>`).
- [ ] New **modals/sheets** trap focus, restore focus on close, and close on Escape (use `hooks/useFocusTrap`).
- [ ] Dynamic status (results, loading, errors) is announced via a **live region** / `role="alert"`.
- [ ] All visible **and** assistive text (incl. `alt`, `aria-label`) is in **i18n (DE + EN)** — no hardcoded strings.
- [ ] New design-token colours pass `npm run check:contrast`.
- [ ] Images have meaningful `alt`, or `alt="" aria-hidden` if decorative.
- [ ] `npm run test:a11y` passes (added coverage for new components where practical).

## Verification

- [ ] `npm test` green
- [ ] `npx tsc --noEmit` clean
