# ADR-0005: User location privacy

- Status: Accepted (2026-10-11; plan tension T1)
- Context: Spec §3 encodes search parameters in the URL; spec §3/§7 forbid exact coordinates in GA4 and durable logs. URLs reach GA4 `page_location`, Vercel request logs and Sentry.

## Decision

- Coordinates from the device (geolocation) are rounded to **2 decimal places (~1.1 km)** before they enter the URL, any API request, logs or analytics.
- Coordinates from a typed search are geocoder centroids (not personal) and are rounded to 3 decimal places.
- The precise device fix stays in client memory only; displayed distances are computed client-side from public venue coordinates.
- GA4 automatic page views are disabled; page views are sent manually with a sanitised `page_location` (no lat/lng).
- Sentry `beforeSend` and the server logger redact `lat`, `lng` and similar keys.
- Reverse geocoding for "Use my location" sends only the rounded coordinates.
- Geolocation is requested automatically only when the Permissions API reports `granted`; never auto-prompt.

## Consequences

- Server-side ordering uses the rounded centre (±~1 km); visible distances remain precise.
