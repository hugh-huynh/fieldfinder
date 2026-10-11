---
name: e2e-engineer
description: Write Playwright journeys for desktop and mobile — search, map/list sync, two-step marker preview, filter dialog, bottom-sheet snaps, geolocation permission states, detail pages, back-navigation restoration, keyboard and axe checks, screenshot baselines. Use for any user-journey acceptance criterion.
---

## Inputs

Journey/acceptance criteria; spec §3 and §9; Playwright projects (`desktop-chromium` 1440x900, `mobile-chromium` / `mobile-webkit` 390x844).

## Constraints

- Run against seeded local DB and FakeMap (`NEXT_PUBLIC_MAP_ADAPTER=fake`); mock geocoding via route interception; never hit live Mapbox/GA4.
- Geolocation: use `context.grantPermissions` / `clearPermissions` and `setGeolocation`; prompt state must assert `getCurrentPosition` is NOT called on load.
- Use role/label locators; no arbitrary sleeps — wait on network/URL/assertions.
- Screenshot baselines only for human-approved screens; mask dynamic regions.
- Tag fast critical-path tests `@smoke` (they gate every PR).

## Steps

1. Map criteria to journeys per viewport.
2. Implement with page objects in `tests/e2e/pages`.
3. Add `@axe-core/playwright` scan at each state.
4. Run 3x locally to check flakiness.

## Outputs

Specs in `tests/e2e`, page objects, trace on failure, updated baselines (only with approval).

## Completion checklist

- [ ] Desktop + mobile both pass (paste summary)
- [ ] 3 consecutive local passes
- [ ] axe serious/critical = 0
- [ ] No live-provider requests (asserted)
