# FieldFinder — Design References

These are the available original design mockup collages from our planning conversation, plus the user-provided Airbnb mobile reference. They are **visual references**, not pixel-perfect individually exported Figma screens.

## Files
- `01-search-and-filters.png`: desktop/mobile search, filter overlay and marker preview concepts.
- `02-search-filters-and-details.png`: search, filters, venue and pitch detail concepts.
- `03-high-fidelity-and-design-system.png`: search, venue/pitch details and design system.
- `04-venue-pitch-states-admin-concepts.png`: venue/pitch detail, loading/error states and earlier admin concept. **Admin dashboard is out of scope for initial implementation.**
- `05-search-and-detail-variations.png`: alternative search and detail mockups.
- `reference-airbnb-mobile-layout.png`: user-provided inspiration for mobile vertical map/results split; do not copy Airbnb branding or assets.

## Authoritative requirements (override any contradictions in screenshots)
1. Brand name: **fieldfinder** (lowercase).
2. Exactly one location search control and one filter button on desktop and mobile. No sort control, persistent filter chips, or always-visible date/player controls.
3. Filter controls open only on demand; desktop modal, mobile full-height-capable sheet. Date/time and players belong within filters (booking-dependent controls deferred).
4. Desktop: side-by-side image-rich venue list and map. Mobile: map above draggable venue results sheet.
5. Map marker tap selects and previews; tapping preview navigates. One published pitch -> pitch detail; multiple published pitches -> venue detail.
6. Geolocation auto-fills if browser permission is already granted; manual search remains available.
7. Admin dashboard, ratings/reviews, payments, and booking are **not** part of the initial release. Admin venue/pitch data is maintained through secured API.
8. Screenshots contain illustrative venue names, photos, counts and attributes; do not treat as verified data.
9. Written product/engineering specifications take precedence over images for functionality; use images for visual direction. Ask before deviating significantly.

## Implementation guidance
Inspect mockups at full resolution. Recreate responsive layouts as real accessible React components; do not use mockup images as the app UI. Establish Playwright screenshot baselines only after review of the implemented screens.
