import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./help.css";

export const metadata: Metadata = {
  title: "ts-rogue wiki",
  description:
    "Guides to the run loop, combat, exploration, and progression in ts-rogue.",
};

// The wiki is the only Tailwind surface in the app, so its stylesheet loads
// here rather than in the root layout and never touches the game portal.
export default function HelpLayout({ children }: { children: ReactNode }) {
  return <div className="dark min-h-dvh bg-background">{children}</div>;
}
