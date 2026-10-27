"use client";

import { ArrowRight, Flag, RefreshCw } from "lucide-react";
import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { DashboardNav } from "@/components/dashboard/dashboard-nav";
import { ErrorState } from "@/components/error-state";
import { ReviewRow } from "@/components/review/review-view";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useReviewAll } from "@/hooks/queries";
import { useHydrated } from "@/hooks/use-hydrated";
import { cn } from "@/lib/utils";

/** The dashboard's Coach review tab: flagged videos from every project, grouped by project. */
export function ReviewOverview() {
  const hydrated = useHydrated();
  const reviewQ = useReviewAll({ live: true });
  // Render data only after hydration so the first client render matches the server HTML.
  const reviews = hydrated ? reviewQ.data : undefined;

  // Projects with the most recently flagged work first.
  const flagged = (reviews ?? [])
    .filter((p) => p.videos.length > 0)
    .sort((a, b) => b.videos[0].annotated_at.localeCompare(a.videos[0].annotated_at));
  const total = flagged.reduce((n, p) => n + p.videos.length, 0);
  const quiet = (reviews?.length ?? 0) - flagged.length;

  let body: React.ReactNode;
  if (!reviews) {
    body =
      hydrated && reviewQ.error ? (
        <div className="rounded-xl border">
          <ErrorState error={reviewQ.error} onRetry={() => reviewQ.refetch()} />
        </div>
      ) : (
        <OverviewListSkeleton />
      );
  } else if (reviews.length === 0) {
    body = (
      <Empty className="border py-20">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Flag />
          </EmptyMedia>
          <EmptyTitle>No project flags videos for review yet</EmptyTitle>
          <EmptyDescription>
            Add a whole-video field such as “Flagged for Review” (true / false, or a checkbox) to a project&apos;s label
            schema. Videos set to true show up here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  } else if (flagged.length === 0) {
    body = (
      <Empty className="border py-20">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Flag />
          </EmptyMedia>
          <EmptyTitle>Nothing to review</EmptyTitle>
          <EmptyDescription>
            No videos are flagged in {reviews.length === 1 ? "the project" : `any of the ${reviews.length} projects`}{" "}
            with a review field. Flagged videos show up here until a coach marks them done.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  } else {
    body = (
      <div className="space-y-8">
        {flagged.map((p) => (
          <section key={p.project_id} aria-labelledby={`review-${p.project_id}`}>
            <div className="mb-2 flex items-baseline justify-between gap-4">
              <h2 id={`review-${p.project_id}`} className="flex min-w-0 items-baseline gap-2 font-medium">
                <span className="truncate">{p.project_name}</span>
                <span className="text-sm font-normal text-muted-foreground tabular-nums">{p.videos.length}</span>
              </h2>
              <Link
                href={`/projects/${p.project_id}/review`}
                className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Open project <ArrowRight className="size-3.5" />
              </Link>
            </div>
            <ul className="divide-y overflow-hidden rounded-xl border">
              {p.videos.map((v) => (
                <li key={v.key}>
                  <ReviewRow
                    projectId={p.project_id}
                    video={v}
                    schema={p.label_schema}
                    reviewKey={p.field?.key ?? ""}
                  />
                </li>
              ))}
            </ul>
            {p.warnings.length > 0 && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{p.warnings.join(" ")}</p>
            )}
          </section>
        ))}
        {quiet > 0 && (
          <p className="text-xs text-muted-foreground">
            {quiet} other project{quiet === 1 ? " has" : "s have"} nothing flagged.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-svh flex-col">
      <AppHeader>
        <DashboardNav />
      </AppHeader>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
              Coach review
              {total > 0 && <span className="text-base font-normal text-muted-foreground tabular-nums">{total}</span>}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Flagged videos from every project, most recently saved first. Open one to review and make changes, then
              mark it done.
            </p>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => reviewQ.refetch()}
                disabled={reviewQ.isFetching}
                aria-label="Refresh"
              >
                <RefreshCw className={cn(reviewQ.isFetching && "animate-spin")} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh (also refreshes on its own every 15 seconds)</TooltipContent>
          </Tooltip>
        </div>
        {body}
      </main>
    </div>
  );
}

function OverviewListSkeleton() {
  return (
    <div className="space-y-8">
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-36 rounded-xl" />
        </div>
      ))}
    </div>
  );
}

export function ReviewOverviewSkeleton() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-16 shrink-0 items-center gap-4 border-b px-6">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-4 w-40" />
      </header>
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <Skeleton className="mb-8 h-12 w-64" />
        <OverviewListSkeleton />
      </div>
    </div>
  );
}
