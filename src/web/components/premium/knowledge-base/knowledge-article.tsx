"use client";

import { Check, Clock3, ThumbsDown, ThumbsUp } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/motion/button/base";
import type { KnowledgeArticle } from "./knowledge-data";

export function KnowledgeArticleContent({
  article,
  compact = false,
}: {
  article: KnowledgeArticle;
  compact?: boolean;
}) {
  const id = useId();
  const [feedback, setFeedback] = useState<{
    articleId: string;
    helpful: boolean;
  } | null>(null);
  const answered = feedback?.articleId === article.id;
  return (
    <div className="min-w-0">
      <header className="mb-8">
        <p className="mb-3 text-xs font-medium text-muted-foreground">
          {article.category}
        </p>
        <h3
          className={compact ? "text-2xl font-medium" : "text-4xl font-medium"}
        >
          {article.title}
        </h3>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          {article.description}
        </p>
        <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Clock3 size={14} />
          {article.readingMinutes} min read
        </p>
      </header>
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_10rem]">
        <div className="space-y-8">
          {article.sections.map((section, index) => (
            <section
              key={section.title}
              id={`${id}-section-${index}`}
              className="scroll-mt-6"
            >
              <h4 className="text-xl font-medium">{section.title}</h4>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                {section.body}
              </p>
              {section.steps && (
                <ol className="mt-4 space-y-3">
                  {section.steps.map((step, stepIndex) => (
                    <li key={step} className="flex gap-3 text-sm leading-6">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-xs tabular-nums">
                        {stepIndex + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ))}
        </div>
        <nav
          aria-label="On this page"
          className="hidden self-start border-l border-border pl-4 xl:block"
        >
          <p className="mb-3 text-xs font-medium">On this page</p>
          {article.sections.map((section, index) => (
            <a
              key={section.title}
              href={`#${id}-section-${index}`}
              className="block rounded-lg py-2 text-xs leading-relaxed text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {section.title}
            </a>
          ))}
        </nav>
      </div>
      <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5">
        <p
          aria-live="polite"
          className="flex items-center gap-2 text-xs text-muted-foreground"
        >
          {answered ? (
            <>
              <Check size={14} />
              Thanks. Your feedback is noted for this preview.
            </>
          ) : (
            "Was this article helpful?"
          )}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="h-9 text-xs focus-visible:ring-2 focus-visible:ring-ring"
            aria-pressed={answered && feedback.helpful}
            onClick={() =>
              setFeedback({ articleId: article.id, helpful: true })
            }
          >
            <ThumbsUp size={14} />
            Yes
          </Button>
          <Button
            variant="outline"
            className="h-9 text-xs focus-visible:ring-2 focus-visible:ring-ring"
            aria-pressed={answered && !feedback.helpful}
            onClick={() =>
              setFeedback({ articleId: article.id, helpful: false })
            }
          >
            <ThumbsDown size={14} />
            Not quite
          </Button>
        </div>
      </div>
    </div>
  );
}
