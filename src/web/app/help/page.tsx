import Link from "next/link";
import { KnowledgeHelpCenter } from "@/components/premium/knowledge-base/knowledge-help-center";

export default function HelpPage() {
  return (
    <>
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-5 pt-8 sm:px-10">
        <span className="font-mono text-sm tracking-widest text-muted-foreground">
          ts-rogue
        </span>
        <Link
          href="/"
          className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
        >
          Back to the portal
        </Link>
      </nav>
      <KnowledgeHelpCenter
        title="The ts-rogue wiki"
        description="Guides to the run loop, combat, exploration, and progression. Search, or pick a topic."
      />
    </>
  );
}
