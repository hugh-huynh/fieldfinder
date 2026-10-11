---
name: react-engineer
description: Build or change Next.js App Router pages and React components for FieldFinder (search layout, cards, map UI, filter dialog, bottom sheet, detail pages). Use when a ticket touches src/app/** pages or src/features/**/components or src/components/**.
---

## Inputs

Ticket + acceptance criteria; spec §3; design README; relevant mockup; `src/styles/tokens.css`; decisions log in `docs/planning/IMPLEMENTATION_PLAN.md`.

## Constraints

- Server Components by default; client components only for interaction (map, sheet, dialog, combobox). No data fetching that bypasses public DTOs.
- Only tokens from tokens.css; Inter; 4px grid; 16px card radius; pill controls. Control outlines use `border-strong`, never `border`.
- Accessible patterns: native elements first; dialogs trap focus and restore it; combobox per ARIA APG; visible focus; 24px min target (WCAG 2.2 2.5.8); respects prefers-reduced-motion.
- Forbidden UI: sort, chips, ratings, prices, login, saved, admin dashboard, live date/players controls.
- The single Filters button sits directly beside the location search on every page.
- Map via MapAdapter only; never import mapbox-gl outside `src/features/map/mapbox/`.

## Steps

1. Restate the interaction contract that applies.
2. Build the component with typed props.
3. Write RTL tests (render, keyboard, states: loading/empty/error/missing image/unknown values).
4. Check desktop (1440) and mobile (390) layouts.

## Outputs

Components, RTL tests, updated fixtures if any, a screenshot or preview note in the PR.

## Completion checklist

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` green (paste output)
- [ ] axe has no serious/critical issues on affected states
- [ ] Keyboard-only path works; focus order sensible
- [ ] No forbidden UI; unknown data shown as "Not confirmed"/omitted
