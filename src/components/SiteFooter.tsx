import Link from "next/link";

import { cx } from "@/lib/cx";

// Privacy and terms on every page (PR 4.1, APP 1: the privacy policy is easy to find). Detail and
// info pages end with the footer; the search page, which fills the screen, shows the same links at
// the end of its results column instead.

const LINK =
  "rounded-sm text-muted underline underline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

export function LegalLinks({ className }: { className?: string }) {
  return (
    <nav aria-label="Site information" className={cx("text-sm", className)}>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        <li>
          <Link href="/privacy" className={LINK}>
            Privacy
          </Link>
        </li>
        <li>
          <Link href="/terms" className={LINK}>
            Terms of use
          </Link>
        </li>
      </ul>
    </nav>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-5xl px-4 py-6 lg:px-6">
        <LegalLinks />
      </div>
    </footer>
  );
}
