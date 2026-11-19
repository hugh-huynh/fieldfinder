import { serializeJsonLd } from "../json-ld";

// A structured-data block (PR 4.2). A JSON data block, not a script: browsers never run it, so the
// CSP's script-src doesn't apply. The content is escaped by serializeJsonLd, which is the only safe
// way to put database text inside a <script> element.

export function JsonLd({ data }: { data: Record<string, unknown> }) {
  // Next's documented way to emit JSON-LD; serializeJsonLd escapes <, > and & so it can't break out.
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
