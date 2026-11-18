import Link from "next/link";

import { SiteFooter } from "@/components/SiteFooter";

// The site's 404 (PR 3.10): unknown addresses, and venues or pitches that aren't published. It never
// says which: a draft and a typo look the same.

export default function NotFound() {
  return (
    <>
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold text-ink">We couldn&apos;t find that page</h1>
        <p className="mt-2 text-muted">It may have moved, or the address may be mistyped.</p>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-12 items-center rounded-pill bg-primary px-6 font-semibold text-surface hover:bg-primary-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Search soccer fields
        </Link>
      </main>
      <SiteFooter />
    </>
  );
}
