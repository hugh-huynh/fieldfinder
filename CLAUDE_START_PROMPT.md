# Claude Code — Start Here

You are implementing **FieldFinder**, a Melbourne-first public soccer field discovery product and future marketplace. Read `docs/specifications/FIELDFINDER_SPEC.md` alongside `docs/design/README.md` in full before proposing any implementation. The specification is the source of truth for product scope, UX, security and quality requirements.

**Do not write application code yet.** First:
1. Review the specification and identify contradictions, missing prerequisites, and decisions requiring human approval.
2. Propose a milestone-by-milestone implementation plan (M1–M4) with small, reviewable PRs, file-level deliverables, dependencies, risks, and objective acceptance tests.
3. Propose exact content for root `CLAUDE.md` and six skills, including invocation triggers, inputs, outputs and verification.
4. Describe how the protected PR, CI/CD, preview, and production approval flow will be configured, distinguishing what requires human account permissions.
5. Give an estimate of external services/cost categories and identify choices to approve before enabling paid resources.
6. Stop and wait for explicit approval to begin M1.

Non-negotiables: no admin dashboard, no login for public visitors, no booking/payment/review features, no sort button, one location search and one Filters button, desktop horizontal map/list, mobile vertical map/bottom sheet, two-step marker preview, single-pitch direct detail routing, secured admin APIs and proprietary data isolation. Never assume generated code is tested until it actually passes tests.
