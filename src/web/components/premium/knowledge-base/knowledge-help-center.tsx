"use client";

import {
  ArrowRight,
  BookOpen,
  Compass,
  FileText,
  Rocket,
  Search,
  Sparkles,
  Swords,
  X,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useId, useState } from "react";
import {
  AnimatedModal,
  AnimatedModalTitle,
} from "@/components/motion/animated-modal";
import { Button } from "@/components/motion/button/base";
import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs";
import { EASE_OUT } from "@/lib/ease";
import { cn } from "@/lib/utils";
import { KnowledgeArticleContent } from "./knowledge-article";
import {
  KNOWLEDGE_ARTICLES,
  type KnowledgeArticle,
  searchKnowledge,
} from "./knowledge-data";

const TOPIC_DETAILS = {
  "Getting started": {
    icon: Rocket,
    description: "Learn the run loop, pick a class, and read the controls.",
  },
  Combat: {
    icon: Swords,
    description: "Turn order, target shapes, status effects, and defeat.",
  },
  Exploration: {
    icon: Compass,
    description: "The overworld, dungeon floors, and fast travel.",
  },
  Progression: {
    icon: Sparkles,
    description: "Skill trees, Guild quests, loot, and saving your run.",
  },
};

export type KnowledgeHelpCenterProps = {
  articles?: readonly KnowledgeArticle[];
  title?: string;
  description?: string;
  className?: string;
};
export function KnowledgeHelpCenter({
  articles = KNOWLEDGE_ARTICLES,
  title = "How can we help?",
  description = "Search guides, explore topics, and find answers for your workspace.",
  className,
}: KnowledgeHelpCenterProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All topics");
  const [selected, setSelected] = useState<KnowledgeArticle | null>(null);
  const reduce = useReducedMotion();
  const id = useId();
  const categories = [...new Set(articles.map((article) => article.category))];
  const topics = ["All topics", ...categories];
  const results = searchKnowledge(articles, query).filter(
    (article) => category === "All topics" || article.category === category,
  );
  return (
    <div
      className={cn(
        "w-full bg-background px-5 py-12 text-foreground sm:px-10",
        className,
      )}
    >
      <div className="mx-auto max-w-5xl">
        <header className="mx-auto mb-10 max-w-2xl text-center">
          <span className="mx-auto mb-5 flex size-12 items-center justify-center rounded-full border border-border">
            <BookOpen size={22} />
          </span>
          <h2 className="text-4xl font-medium">{title}</h2>
          <p className="mx-auto mt-5 max-w-lg text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
          <div className="relative mx-auto mt-7 max-w-lg">
            <Search
              size={17}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              id={`${id}-search`}
              type="search"
              aria-label="Search help articles"
              placeholder="Search for an answer…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-10 w-full rounded-full border border-border bg-background pl-11 pr-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </header>
        <div className="mb-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {categories.map((topic) => {
            const details = TOPIC_DETAILS[topic as keyof typeof TOPIC_DETAILS];
            const Icon = details?.icon ?? BookOpen;
            const count = articles.filter(
              (article) => article.category === topic,
            ).length;
            return (
              <div
                key={topic}
                className="flex flex-col rounded-2xl border border-border bg-background p-4 transition-colors hover:border-foreground/25"
              >
                <div className="mb-4 flex items-center justify-between gap-3">
                  <span className="flex size-9 items-center justify-center rounded-full border border-border">
                    <Icon size={19} />
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {count} {count === 1 ? "article" : "articles"}
                  </span>
                </div>
                <h3 className="text-xl font-medium">{topic}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                  {details?.description ??
                    `Browse guides and answers about ${topic.toLowerCase()}.`}
                </p>
                <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                  <span className="text-xs text-muted-foreground">
                    Explore guides
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setCategory(topic)}
                    aria-label={`Browse ${topic}`}
                    className="relative size-9 rounded-full after:absolute after:-inset-1 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ArrowRight size={15} />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <h3 className="text-2xl font-medium">Explore articles</h3>
          <Tabs
            value={category}
            onValueChange={setCategory}
            variant="pill"
            className="max-w-full overflow-x-auto p-1"
          >
            <TabsList
              aria-label="Help topics"
              className="min-w-max gap-2 bg-transparent p-0"
            >
              {topics.map((topic, index) => (
                <TabsTrigger
                  key={topic}
                  value={topic}
                  id={`${id}-topic-${index}`}
                  aria-controls={`${id}-results`}
                  tabIndex={category === topic ? 0 : -1}
                  className="h-9 px-3 py-0 text-xs focus-visible:ring-2 focus-visible:ring-ring"
                  onKeyDown={(event) => {
                    if (
                      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                        event.key,
                      )
                    )
                      return;
                    event.preventDefault();
                    const next =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? topics.length - 1
                          : (index +
                              (event.key === "ArrowRight" ? 1 : -1) +
                              topics.length) %
                            topics.length;
                    setCategory(topics[next]);
                    document.getElementById(`${id}-topic-${next}`)?.focus();
                  }}
                >
                  {topic}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        <p aria-live="polite" className="mb-3 text-xs text-muted-foreground">
          {results.length} {results.length === 1 ? "article" : "articles"}
          {query ? ` matching “${query}”` : " to explore"}
        </p>
        <div
          role="tabpanel"
          id={`${id}-results`}
          aria-labelledby={`${id}-topic-${topics.indexOf(category)}`}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${query}-${category}`}
              initial={{ opacity: 0, y: reduce ? 0 : 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.12, ease: EASE_OUT }}
            >
              {results.length ? (
                <div className="divide-y divide-border border-y border-border">
                  {results.map((article) => (
                    <div
                      key={article.id}
                      className="flex w-full items-center gap-4 px-1 py-5 text-left"
                    >
                      <FileText
                        size={18}
                        className="shrink-0 text-muted-foreground"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">
                          {article.title}
                        </span>
                        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                          {article.description}
                        </span>
                      </span>
                      <span className="hidden text-xs text-muted-foreground sm:block">
                        {article.readingMinutes} min
                      </span>
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label={`Read ${article.title}`}
                        onClick={() => setSelected(article)}
                        className="relative size-9 shrink-0 rounded-full after:absolute after:-inset-1 focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <ArrowRight size={16} />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-border px-5 py-12 text-center">
                  <Search size={24} className="mx-auto text-muted-foreground" />
                  <h3 className="mt-4 text-xl font-medium">
                    No articles found
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Try a broader search or explore another topic.
                  </p>
                  <Button
                    variant="outline"
                    className="mt-5 h-9 rounded-full text-xs focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => {
                      setQuery("");
                      setCategory("All topics");
                    }}
                  >
                    Clear filters
                  </Button>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
        <AnimatedModal
          open={selected !== null}
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
          panelClassName="max-w-4xl rounded-2xl p-5 sm:p-8"
          backdropClassName="backdrop-blur-sm"
        >
          <AnimatedModalTitle className="sr-only">
            {selected?.title ?? "Help article"}
          </AnimatedModalTitle>
          <div className="mb-3 flex justify-end">
            <Button
              size="icon"
              variant="ghost"
              aria-label="Close article"
              className="size-9 rounded-full focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setSelected(null)}
            >
              <X size={18} />
            </Button>
          </div>
          {selected && <KnowledgeArticleContent article={selected} compact />}
        </AnimatedModal>
      </div>
    </div>
  );
}
