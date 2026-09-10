import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import "./globals.css";

/**
 * Terminal font. wterm lays each row out as text runs, not per-cell, so a
 * glyph the font lacks is drawn from a fallback with a different advance and
 * shifts everything after it. Cascadia Mono ships Braille (the first-person
 * view), box drawing and block elements, so no cell ever falls back.
 * Licensed under the SIL Open Font License 1.1.
 */
const terminalFont = localFont({
  src: [
    { path: "./fonts/CascadiaMono-Regular.woff2", weight: "400" },
    { path: "./fonts/CascadiaMono-Bold.woff2", weight: "700" },
  ],
  variable: "--font-terminal",
  display: "block",
});

export const metadata: Metadata = {
  title: "ts-rogue",
  description:
    "A terminal dungeon crawler, played through a portal in the browser.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={terminalFont.variable}>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
