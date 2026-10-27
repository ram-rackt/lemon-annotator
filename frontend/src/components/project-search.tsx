"use client";

import { CloudOff, FolderKanban, Search } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { useProjects } from "@/hooks/queries";
import { useHydrated } from "@/hooks/use-hydrated";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";

const MAX_RESULTS = 8;

/** Name matches first (those starting with the query before others), then description matches. */
function rank(projects: Project[], query: string): Project[] {
  const q = query.trim().toLowerCase();
  if (!q) return projects.slice(0, MAX_RESULTS);
  const score = (p: Project) => {
    const name = p.name.toLowerCase();
    if (name.startsWith(q)) return 0;
    if (name.includes(q)) return 1;
    if (p.description.toLowerCase().includes(q)) return 2;
    return -1;
  };
  return projects
    .map((p) => ({ p, s: score(p) }))
    .filter(({ s }) => s >= 0)
    .sort((a, b) => a.s - b.s || a.p.name.localeCompare(b.p.name))
    .slice(0, MAX_RESULTS)
    .map(({ p }) => p);
}

/** The project name with the matched part emphasised. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-yellow-300/40 text-inherit dark:bg-yellow-300/25">
        {text.slice(i, i + q.length)}
      </mark>
      {text.slice(i + q.length)}
    </>
  );
}

/** Smaller screens: a search button opening the same search in a dialog. */
export function ProjectSearchButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" aria-label="Search projects" className={cn("size-10 rounded-lg", className)}>
          <Search className="size-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="top-[15%] translate-y-0 gap-0 p-3 sm:max-w-md" showCloseButton={false}>
        <DialogTitle className="sr-only">Search projects</DialogTitle>
        <ProjectSearch variant="panel" onNavigate={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Search over project names. "bar": navbar field with a dropdown; Ctrl+K / ⌘K focuses it from anywhere.
 * "panel": field with the results always shown below it (inside the small-screen dialog).
 */
export function ProjectSearch({
  className,
  variant = "bar",
  onNavigate,
}: {
  className?: string;
  variant?: "bar" | "panel";
  onNavigate?: () => void;
}) {
  const panel = variant === "panel";
  const router = useRouter();
  const params = useParams<{ projectId?: string }>();
  const hydrated = useHydrated();
  const projectsQ = useProjects();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const results = useMemo(() => rank(projectsQ.data ?? [], query), [projectsQ.data, query]);
  const isMac = hydrated && /mac|iphone|ipad/i.test(navigator.userAgent);

  useEffect(() => {
    if (panel) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [panel]);

  const showResults = panel || open;

  const close = () => {
    setOpen(false);
    setActive(0);
  };

  const go = (project: Project) => {
    // Same destination as the project's card on the dashboard.
    router.push(project.storage.is_configured ? `/projects/${project.id}` : `/projects/${project.id}/settings`);
    setQuery("");
    close();
    inputRef.current?.blur();
    onNavigate?.();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      if (results.length) {
        setActive((i) =>
          e.key === "ArrowDown" ? (i + 1) % results.length : (i - 1 + results.length) % results.length,
        );
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = results[active];
      if (showResults && target) go(target);
    } else if (e.key === "Escape" && !panel) {
      // (In the dialog, Escape closes the dialog.)
      if (query) setQuery("");
      else inputRef.current?.blur();
      close();
    }
  };

  const optionId = (i: number) => `${listId}-option-${i}`;

  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute top-5 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label="Search projects"
        aria-expanded={showResults}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showResults && results[active] ? optionId(active) : undefined}
        placeholder="Search projects…"
        autoComplete="off"
        spellCheck={false}
        autoFocus={panel}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={close}
        onKeyDown={onKeyDown}
        className="h-10 w-full rounded-lg border border-foreground/10 bg-background/60 pr-16 pl-9 text-sm shadow-sm transition-colors outline-none placeholder:text-muted-foreground hover:bg-background focus-visible:border-yellow-400 focus-visible:bg-background focus-visible:ring-3 focus-visible:ring-yellow-400/25 [&::-webkit-search-cancel-button]:hidden"
      />
      {!panel && (
        <Kbd className="pointer-events-none absolute top-5 right-2.5 -translate-y-1/2">{isMac ? "⌘K" : "Ctrl K"}</Kbd>
      )}

      {showResults && (
        <div
          // Keep focus in the input while clicking a result.
          onMouseDown={(e) => e.preventDefault()}
          className={cn(
            "overflow-hidden rounded-xl border bg-popover text-popover-foreground",
            panel ? "mt-3" : "absolute top-full right-0 z-50 mt-2 w-full min-w-80 shadow-xl",
          )}
        >
          <div className="border-b px-3 py-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {query.trim() ? "Matching projects" : "Projects"}
          </div>
          <ul id={listId} role="listbox" aria-label="Projects" className="max-h-80 overflow-y-auto p-1.5">
            {projectsQ.isPending ? (
              <li className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
                <Spinner /> Loading projects…
              </li>
            ) : projectsQ.error && !projectsQ.data ? (
              <li className="px-3 py-3 text-sm text-destructive">
                Couldn&apos;t load projects. Try again in a moment.
              </li>
            ) : results.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                {query.trim() ? <>No projects match &ldquo;{query.trim()}&rdquo;.</> : "No projects yet."}
              </li>
            ) : (
              results.map((p, i) => {
                const total = p.last_sync?.video_count ?? 0;
                const done = Math.min(p.stats.completed, total);
                const current = p.id === params.projectId;
                return (
                  <li
                    key={p.id}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(p)}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2",
                      i === active && "bg-accent text-accent-foreground",
                    )}
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg border bg-muted/50 text-muted-foreground">
                      {p.storage.is_configured ? <FolderKanban className="size-4" /> : <CloudOff className="size-4" />}
                    </span>
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate text-sm font-medium">
                        <Highlight text={p.name} query={query} />
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {!p.storage.is_configured
                          ? "Storage not configured"
                          : p.last_sync
                            ? `${done} / ${total} completed`
                            : "Not scanned yet"}
                      </span>
                    </span>
                    {current && (
                      <span className="shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        Current
                      </span>
                    )}
                  </li>
                );
              })
            )}
          </ul>
          <div className="flex items-center gap-3 border-t bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
            <span>
              <Kbd>↑</Kbd> <Kbd>↓</Kbd> to move
            </span>
            <span>
              <Kbd>↵</Kbd> to open
            </span>
            <span>
              <Kbd>Esc</Kbd> to close
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
