import { http, HttpResponse } from "msw";

// Mapbox Geocoding v6 forward-search stand-in for unit tests (PR 2.13). Shape follows Mapbox's
// GeoJSON response; ids and coordinates are synthetic. Records each request so tests can check
// exactly what would have been sent upstream.

export const MAPBOX_FORWARD = "https://api.mapbox.com/search/geocode/v6/forward";

export const sampleFeatures = [
  {
    type: "Feature",
    id: "dXJuOm1ieHBsYzpzeW50aGV0aWMtMQ",
    geometry: { type: "Point", coordinates: [144.96036, -37.76712] },
    properties: {
      mapbox_id: "dXJuOm1ieHBsYzpzeW50aGV0aWMtMQ",
      feature_type: "locality",
      name: "Brunswick",
      place_formatted: "Victoria 3056, Australia",
      coordinates: { longitude: 144.96036, latitude: -37.76712 },
    },
  },
  {
    type: "Feature",
    id: "dXJuOm1ieHBsYzpzeW50aGV0aWMtMg",
    geometry: { type: "Point", coordinates: [144.95431, -37.75598] },
    properties: {
      mapbox_id: "dXJuOm1ieHBsYzpzeW50aGV0aWMtMg",
      feature_type: "address",
      name: "1 Example Street",
      full_address: "1 Example Street, Brunswick West Victoria 3055, Australia",
      coordinates: { longitude: 144.95431, latitude: -37.75598 },
    },
  },
];

export function mapboxForward(
  reply: (url: URL) => Response | Promise<Response> = () =>
    HttpResponse.json({ type: "FeatureCollection", features: sampleFeatures }),
) {
  const requests: URL[] = [];
  const handler = http.get(MAPBOX_FORWARD, ({ request }) => {
    const url = new URL(request.url);
    requests.push(url);
    return reply(url);
  });
  return { handler, requests };
}
