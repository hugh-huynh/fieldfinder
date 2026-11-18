import type { ReactNode } from "react";

import { SiteFooter } from "@/components/SiteFooter";

// The shared frame of /privacy and /terms (PR 4.1): a readable column, a draft notice until the
// wording has been reviewed (plan P5), and the footer.

export const LAST_UPDATED = "18 November 2026";

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <main className="mx-auto max-w-3xl px-4 pt-8 pb-16 lg:px-6">
        <h1 className="text-3xl font-semibold text-ink">{title}</h1>
        <p className="mt-2 text-sm text-muted">Last updated {LAST_UPDATED}</p>
        <p role="note" className="mt-6 rounded-card border border-border bg-subtle p-4 text-sm text-ink">
          <strong>Draft.</strong> This page is being reviewed and will be finalised before FieldFinder launches. Items
          in [square brackets] are still to be filled in.
        </p>
        <div className="mt-8 flex flex-col gap-8 text-ink [&_a]:font-semibold [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:mt-1 [&_p]:mt-3 [&_p]:leading-relaxed [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-6">
          {children}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}
