"use client";

import { ChartColumn } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { DashboardNav } from "@/components/dashboard/dashboard-nav";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useProgressAccess } from "@/hooks/queries";
import { useHydrated } from "@/hooks/use-hydrated";

// TEST DATA: hard-coded copies of the project cards' numbers, to try the page out. Replace with real
// per-project counts before relying on it.
const FOLDERS = [
  { name: "Youtube Playlist", completed: 40, total: 58 },
  { name: "Backhand rear court", completed: 23, total: 23 },
  { name: "OverHead", completed: 11, total: 11 },
  { name: "Backhand front", completed: 125, total: 158 },
  { name: "Forehand Front", completed: 200, total: 238 },
  { name: "Forehand Rear", completed: 58, total: 58 },
];

/** The Progress tab: how many videos are done in total and in each folder. For the team and coaches (the
 * server says who: /api/stats/progress). */
export function ProgressView() {
  const hydrated = useHydrated();
  const accessQ = useProgressAccess();
  const available = hydrated ? accessQ.data?.available : undefined;

  return (
    <div className="flex min-h-svh flex-col">
      <AppHeader>
        <DashboardNav />
      </AppHeader>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">Progress</h1>
          <p className="mt-1 text-sm text-muted-foreground">How many videos are completed, in total and per folder.</p>
        </div>
        {available === undefined ? (
          <div className="space-y-6">
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        ) : available ? (
          <FolderProgress />
        ) : (
          <Empty className="border py-20">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ChartColumn />
              </EmptyMedia>
              <EmptyTitle>Progress is for the team and coaches</EmptyTitle>
              <EmptyDescription>Ask the owner to add your email to the team or the coaches.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </main>
    </div>
  );
}

function FolderProgress() {
  const rows = [...FOLDERS].sort((a, b) => b.completed - a.completed);
  const completed = rows.reduce((n, r) => n + r.completed, 0);
  const total = rows.reduce((n, r) => n + r.total, 0);
  const pct = total ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* The headline: everything done so far. */}
      <section aria-label="Total" className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3">
        <Stat label="Videos completed" value={completed.toLocaleString()} />
        <Stat label="Videos in all folders" value={total.toLocaleString()} />
        <Stat label="Done" value={`${pct}%`} />
      </section>

      <section aria-labelledby="folder-progress-title" className="rounded-xl border bg-card p-5 sm:p-6">
        <h2 id="folder-progress-title" className="mb-5 font-medium">
          Completed videos by folder
        </h2>
        {/* The list is its own table view: every folder's counts are written out. */}
        <ul className="grid gap-x-10 gap-y-1 lg:grid-cols-2">
          {rows.map((r) => (
            <li key={r.name}>
              <Row label={r.name} completed={r.completed} total={r.total} />
            </li>
          ))}
        </ul>
        <div className="mt-4 border-t pt-4">
          <Row label="Total" completed={completed} total={total} strong />
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card px-5 py-4 sm:px-6 sm:py-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
    </div>
  );
}

function Row({
  label,
  completed,
  total,
  strong,
}: {
  label: string;
  completed: number;
  total: number;
  strong?: boolean;
}) {
  const pct = total ? (completed / total) * 100 : 0;
  return (
    <div
      className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto] items-center gap-3 px-1.5 py-1.5"
      title={`${label}: ${completed} of ${total} completed (${Math.round(pct)}%)`}
    >
      <span className={strong ? "text-sm font-medium" : "truncate text-sm"}>{label}</span>
      <span aria-hidden className="h-2.5 overflow-hidden rounded-full bg-muted">
        {/* Square at the baseline, 4px rounded at the data end. */}
        <span className="block h-full rounded-r-[4px] bg-[#2a78d6] dark:bg-[#3987e5]" style={{ width: `${pct}%` }} />
      </span>
      <span className="text-right text-sm tabular-nums">
        <span className="font-medium">{completed.toLocaleString()}</span>
        <span className="text-muted-foreground"> / {total.toLocaleString()}</span>
      </span>
    </div>
  );
}
