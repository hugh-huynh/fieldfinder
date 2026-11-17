// "Get directions" for a venue (spec §3 details, PR 3.10): Google Maps' documented cross-platform
// directions URL to the venue's public coordinates. It opens the person's maps app or the web; no
// API key, nothing about the person is sent by us (Google gets only what the browser sends it).

export function directionsUrl(latitude: number, longitude: number): string {
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("destination", `${String(latitude)},${String(longitude)}`);
  return url.toString();
}
