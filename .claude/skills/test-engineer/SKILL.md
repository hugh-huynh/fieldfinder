---
name: test-engineer
description: Write or repair Vitest, React Testing Library and MSW tests for logic, components and API route handlers. Use when adding behaviour, fixing a bug (write the failing test first), or when coverage of critical logic is missing.
---

## Inputs

Code under test, acceptance criteria, spec §9, fixtures in `tests/fixtures`.

## Constraints

- Synthetic fixture data only; mock Mapbox/GA4/Sentry/Upstash with MSW or adapters. MSW runs with `onUnhandledRequest: "error"` — never weaken it.
- Test behaviour through public interfaces; query by role/label; no snapshot-only tests for logic.
- Every happy path gets at least one negative case (invalid input, unauthorised, absent/unpublished, provider error).
- Deterministic: fake timers for debounce, seeded data, no reliance on test order.
- Files: `*.test.ts` runs in the `unit` (node) project, `*.test.tsx` in the `component` (jsdom) project.

## Steps

1. List cases (happy, edge, negative, security).
2. Write tests; confirm a new test fails before the fix when fixing bugs.
3. Run and record results.

## Outputs

Test files co-located (`*.test.ts[x]`) or under `tests/unit` / `tests/integration`; MSW handlers; fixture additions.

## Completion checklist

- [ ] Failing-first evidence for bug fixes
- [ ] Negative cases present
- [ ] `pnpm test` (and `pnpm test:integration` if DB) output pasted, with counts
- [ ] No skipped/only tests left
