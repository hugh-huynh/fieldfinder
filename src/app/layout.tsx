import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";

import { Analytics } from "@/features/analytics/components/Analytics";
import { SITE_NAME } from "@/features/seo/metadata";
import { AppHeader } from "@/features/search/components/AppHeader";
import { siteOrigin } from "@/lib/site";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

// `metadataBase` makes every page's canonical and Open Graph URL absolute (PR 4.2, src/lib/site.ts).
export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
  title: SITE_NAME,
  description: "Find public soccer fields near you in Melbourne.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-AU" className={inter.variable}>
      <body className="font-sans antialiased">
        {/* Before the page: the consent banner sits above the header, and each navigation's page view
            is sent before the page's own analytics events (PR 4.1). Reads the URL, so it suspends. */}
        <Suspense fallback={null}>
          <Analytics />
        </Suspense>
        <AppHeader />
        {children}
      </body>
    </html>
  );
}
