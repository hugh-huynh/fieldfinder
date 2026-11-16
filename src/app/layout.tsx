import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

import { AppHeader } from "@/features/search/components/AppHeader";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "FieldFinder",
  description: "Find public soccer fields near you in Melbourne.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-AU" className={inter.variable}>
      <body className="font-sans antialiased">
        <AppHeader />
        {children}
      </body>
    </html>
  );
}
