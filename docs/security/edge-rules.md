# Edge rules (Vercel Firewall)

Status: **to be applied by Hugh** (ticket 4.3). This file is the source of truth for FieldFinder's Vercel Firewall configuration. ADR-0004 records the decisions behind it. Change the rules here first, then apply them.

## Who limits what

| Traffic                           | Limited by                                                        | Why                                                                                 |
| --------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Public API, detail pages, sitemap | **Edge only** (the rules below)                                   | Blocked requests never reach a function or the database (ADR-0004, D5 option B).    |
| Admin API                         | Edge (per IP) **and** app (per credential, global)                | The app limit can't be spread across edge regions, and it can count per credential. |
| Admin uploads                     | App: 30 per 10 min per credential (`src/lib/rate-limit/rules.ts`) | Each upload decodes up to 10 MB with sharp.                                         |
| Failed admin logins               | App: 10 per min per client IP                                     | Stops token guessing.                                                               |

Edge counters are per region, so a client spread across regions can go over a limit in total. The limits below are **starting hypotheses** (spec §6). Tune them against the Firewall traffic view after launch. Don't treat them as fixed policy.

## Managed rulesets

| Ruleset        | Setting at launch | Then                                                                                                                                                                            |
| -------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bot Protection | `log`             | `challenge` after a week of clean logs (`rules update bot-protection --action challenge`, then `publish`). Real browsers pass; verified search crawlers are excluded by Vercel. |
| AI Bots        | `deny`            | Matches the terms of use (no bulk copying except search engines following robots rules). Change it here if that policy changes.                                                 |

Vercel verifies "verified bots" (Googlebot, Bingbot, …) itself, by IP range, reverse DNS or signed requests, and Bot Protection never challenges them. Bot Protection doesn't work behind another proxy, so Cloudflare stays **DNS-only** (ADR-0004).

## Custom rules

These are rate-limit rules keyed on client IP, with a 60 s fixed window. The action is `rate_limit`, which answers 429. They're listed in evaluation order.

| #   | Name            | Path condition                | Limit / 60 s / IP | Notes                                                                                    |
| --- | --------------- | ----------------------------- | ----------------- | ---------------------------------------------------------------------------------------- |
| 1   | `api-search`    | `/api/venues` (exact)         | 60                | Search. Pages are bounded at 30 results, with cursors (ADR-0004).                        |
| 2   | `api-detail`    | starts with `/api/venues/`    | 120               | Venue and pitch JSON.                                                                    |
| 3   | `api-locations` | starts with `/api/locations/` | 30                | Suggest and reverse geocoding. Each call can cost a Mapbox request.                      |
| 4   | `api-admin`     | starts with `/api/admin/`     | 60                | One operator. The app adds per-credential limits on top.                                 |
| 5   | `pages-detail`  | starts with `/venues/`        | 120               | Server-rendered venue and pitch pages: the same data as rule 2, in HTML. **New in 4.3.** |
| 6   | `sitemap`       | `/sitemap.xml` (exact)        | 10                | Built per request from the database (PR 4.2). Crawlers fetch it rarely. **New in 4.3.**  |

Rules 5 and 6 are the crawled pages. Googlebot treats a 429 as "slow down" and backs off. It doesn't drop pages for a brief 429, but sustained 429s reduce crawling. If the traffic view shows a **verified** crawler being limited, raise rule 5 first (see [Crawlers](#crawlers)).

## Apply with the Vercel CLI

Run these from the linked project (`vercel link`), signed in as an owner of the team. `rules add` and `rules update` stage drafts: custom rules and managed bot rules alike. Nothing changes until `publish`.

The managed bot rules are changed with `rules update`, using their IDs from the CLI reference. `bot-protection` takes `off`, `log` or `challenge`; `ai-bots` takes `allow`, `log`, `challenge` or `deny`. `vercel firewall bot-management` only lists them. The dashboard toggles (Project → Firewall → Bot Management) do the same.

```sh
vercel firewall rules update bot-protection --action log --yes
vercel firewall rules update ai-bots --action deny --yes

vercel firewall rules add "api-search" \
  --description "Search: 60 per minute per IP (docs/security/edge-rules.md)" \
  --condition '{"type":"path","op":"eq","value":"/api/venues"}' \
  --action rate_limit --rate-limit-window 60 --rate-limit-requests 60 --rate-limit-keys ip --rate-limit-action rate_limit --yes

vercel firewall rules add "api-detail" \
  --description "Venue/pitch JSON: 120 per minute per IP (docs/security/edge-rules.md)" \
  --condition '{"type":"path","op":"pre","value":"/api/venues/"}' \
  --action rate_limit --rate-limit-window 60 --rate-limit-requests 120 --rate-limit-keys ip --rate-limit-action rate_limit --yes

vercel firewall rules add "api-locations" \
  --description "Location lookups (Mapbox): 30 per minute per IP (docs/security/edge-rules.md)" \
  --condition '{"type":"path","op":"pre","value":"/api/locations/"}' \
  --action rate_limit --rate-limit-window 60 --rate-limit-requests 30 --rate-limit-keys ip --rate-limit-action rate_limit --yes

vercel firewall rules add "api-admin" \
  --description "Admin API: 60 per minute per IP; the app also limits per credential (docs/security/edge-rules.md)" \
  --condition '{"type":"path","op":"pre","value":"/api/admin/"}' \
  --action rate_limit --rate-limit-window 60 --rate-limit-requests 60 --rate-limit-keys ip --rate-limit-action rate_limit --yes

vercel firewall rules add "pages-detail" \
  --description "Venue/pitch pages: 120 per minute per IP (docs/security/edge-rules.md)" \
  --condition '{"type":"path","op":"pre","value":"/venues/"}' \
  --action rate_limit --rate-limit-window 60 --rate-limit-requests 120 --rate-limit-keys ip --rate-limit-action rate_limit --yes

vercel firewall rules add "sitemap" \
  --description "Sitemap (built per request): 10 per minute per IP (docs/security/edge-rules.md)" \
  --condition '{"type":"path","op":"eq","value":"/sitemap.xml"}' \
  --action rate_limit --rate-limit-window 60 --rate-limit-requests 10 --rate-limit-keys ip --rate-limit-action rate_limit --yes

vercel firewall diff        # review the staged changes
vercel firewall publish     # make them live (asks you to confirm the project name)
```

The same rules can be entered in the dashboard (Project → Firewall → Configure). Rate-limit rules need a plan that includes them (ADR-0004 assumes Pro). If the plan allows fewer rules, apply them in the order above.

### Check after publishing

```sh
for i in $(seq 1 15); do curl -s -o /dev/null -w "%{http_code}\n" "https://<production-host>/sitemap.xml"; done | sort | uniq -c
```

Expect 10 × `200`, then 5 × `429`. The sitemap is the cheapest limited route: two small queries, and no Mapbox call. A minute later it answers `200` again.

## Export (committed evidence)

Once the rules are live, record exactly what was applied:

```sh
vercel firewall rules list --json --expand > docs/security/edge-rules.export.json
vercel firewall bot-management --json > docs/security/edge-rules.bot-management.json   # managed bot rules' current actions
```

Read both files before committing. They should hold rule names, conditions and actions only, with no tokens or secrets. Commit them next to this file. Re-export after every change, so the repo always shows what's live.

## Crawlers

robots.txt is advisory (spec §6). The limits above apply to crawlers like anyone else. Policy:

1. **Never allowlist or exempt by User-Agent.** Anyone can send `Googlebot`. Vercel's Bot Protection already passes verified crawlers. Custom rules can't match "verified bot" (the CLI has no such condition), so an exemption would have to be by IP.
2. **Before any IP exemption**, verify every address with the tool in this repo:

   ```sh
   pnpm crawler:verify 66.249.66.1 157.55.39.1
   # 66.249.66.1  VERIFIED  Googlebot (crawl-66-249-66-1.googlebot.com)
   ```

   It does Google's and Bing's documented check: reverse DNS must give a name in `googlebot.com`, `google.com` or `search.msn.com`, and that name must resolve forward to the same IP (`src/lib/rate-limit/crawler.ts`). It deliberately rejects `googleusercontent.com`, where any Google Cloud customer's machine resolves.

3. **Prefer raising a limit to exempting.** An exemption is an IP-range `bypass` rule placed before the limits, and it needs re-verifying when Google or Bing change ranges. Record any such rule here with the verification output.

## Not covered here

- Alerts on 429 rates and enumeration patterns are ticket 4.4.
- Caching the sitemap at the edge is a possible later step if crawl load ever matters.
