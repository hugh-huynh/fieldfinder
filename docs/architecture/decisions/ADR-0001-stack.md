# ADR-0001: Application stack and tooling

- Status: Accepted (2026-10-11; D1, D3, D19, D22, D23)
- Context: Spec §2 fixes the broad stack; exact choices and versions needed approval.

## Decision

- **Runtime/tooling:** Node 22 LTS (≥ 22.12, pinned in `.nvmrc`), pnpm (pinned via `packageManager`). Dependency install scripts are deny-by-default (`allowBuilds` in `pnpm-workspace.yaml`); each allowance needs review.
- **App:** Next.js App Router (16.x), React 19, TypeScript strict + `noUncheckedIndexedAccess`, Tailwind CSS v4 with tokens in `src/styles/tokens.css`, Inter via `next/font`.
- **Quality:** ESLint 9 (next core-web-vitals + typescript-eslint `strictTypeChecked` + jsx-a11y strict), Prettier.
- **Tests:** Vitest (unit = node, component = jsdom) + RTL + MSW (unhandled requests fail); Playwright (desktop 1440×900, mobile 390×844 Chromium + WebKit) + axe.
- **Map:** `mapbox-gl` + `react-map-gl` behind a `MapAdapter` interface with a deterministic `FakeMap` for tests/screenshots.
- **Bottom sheet:** custom component (pointer drag + three snap buttons + keyboard) rather than a library.
- **API contract:** OpenAPI generated from the same Zod schemas (`@asteasolutions/zod-to-openapi`), checked in, CI drift check.
- **Hosting:** Vercel Pro (Hobby is non-commercial only).
- Versions are exact pins; new releases wait ≥ 14 days unless they fix a security advisory.

## Consequences

- Vite 8 / rolldown require Node ≥ 22.12; older Node fails at Vitest startup.
- Upgrades arrive through Dependabot (grouped, 14-day cooldown) and need human approval.
