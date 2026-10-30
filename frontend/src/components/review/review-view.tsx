"use client";

import { ArrowRight, CheckCheck, Flag, Play, RefreshCw, Settings2, Tags } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";

import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useFinishReview, useProject, useReview } from "@/hooks/queries";
import { useHydrated } from "@/hooks/use-hydrated";
import { errorMessage } from "@/lib/api";
import { formatRelative, formatTime } from "@/lib/format";
import { reviewField, reviewFieldOptions } from "@/lib/schema";
import type { Project, ReviewVideo } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Every video whose coach-review checkbox (chosen in Settings > General) is ticked. */
export function ReviewView() {
  const { projectId } = useParams<{ projectId: string }>();
  const hydrated = useHydrated();
  const projectQ = useProject(projectId);
  // Render data only after hydration so the first client render matches the server HTML.
  const project = hydrated ? projectQ.data : undefined;
  const field = project ? reviewField(project.label_schema, project.settings.coach_review_field) : undefined;
  const reviewQ = useReview(projectId, { enabled: Boolean(field), live: true });
  const list = hydrated ? reviewQ.data : undefined;

  let body: React.ReactNode;
  if (!hydrated || projectQ.isPending) body = <ReviewListSkeleton />;
  else if (!project) body = <ErrorState error={projectQ.error} onRetry={() => projectQ.refetch()} />;
  else if (!field) body = <NotSetUp project={project} />;
  else if (!list) {
    body = reviewQ.error ? (
      <ErrorState error={reviewQ.error} onRetry={() => reviewQ.refetch()} />
    ) : (
      <ReviewListSkeleton />
    );
  } else if (list.videos.length === 0) {
    body = (
      <Empty className="border py-20">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Flag />
          </EmptyMedia>
          <EmptyTitle>Nothing to review yet</EmptyTitle>
          <EmptyDescription>
            Set “{field.label}” to {field.type === "checkbox" ? "ticked" : "true"} on a video while annotating and it
            shows up here until a coach marks it done.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild variant="outline">
            <Link href={`/projects/${projectId}`}>
              Go to Annotate <ArrowRight />
            </Link>
          </Button>
        </EmptyContent>
      </Empty>
    );
  } else {
    body = (
      <>
        <ul className="divide-y overflow-hidden rounded-xl border">
          {list.videos.map((v) => (
            <li key={v.key}>
              <ReviewRow projectId={projectId} video={v} />
            </li>
          ))}
        </ul>
        {list.warnings.length > 0 && (
          <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">{list.warnings.join(" ")}</p>
        )}
      </>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
              Coach review
              {list && list.videos.length > 0 && (
                <span className="text-base font-normal text-muted-foreground tabular-nums">{list.videos.length}</span>
              )}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {field
                ? `Videos flagged with “${field.label}”, most recently saved first. Open one to review and make changes, then mark it done.`
                : "Videos your annotators flag for a coach to look at."}
            </p>
          </div>
          {field && (
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
          )}
        </div>
        {body}
      </main>
    </div>
  );
}

/** One flagged video: its name, where it sits (last folder only), length and when it was last updated. */
export function ReviewRow({ projectId, video }: { projectId: string; video: ReviewVideo }) {
  const folders = video.key.split("/").slice(0, -1);
  // Just the nearest folder: enough to tell same-named clips apart (the full path is in the tooltip).
  const folder = folders.at(-1);
  const finish = useFinishReview(projectId);

  const done = () =>
    finish.mutate(video.key, {
      onSuccess: () => toast.success(`Review done: ${video.filename}`, { duration: 2000 }),
      onError: (err) => {
        const { title, hint } = errorMessage(err);
        toast.error(`Couldn't finish the review: ${title}`, { description: hint ?? undefined });
      },
    });

  return (
    <div className="flex items-center transition-colors hover:bg-muted/40">
      <Link
        href={`/projects/${projectId}?v=${encodeURIComponent(video.key)}`}
        className="group flex min-w-0 flex-1 items-center gap-3.5 py-3 pl-4 focus-visible:bg-muted/40 focus-visible:outline-none"
        title={`${video.key}\nOpen to review and make changes`}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-300">
          <Play className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{video.filename}</div>
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {folder && <span className="truncate">{folder}</span>}
            {folder && video.duration_seconds != null && <span aria-hidden>·</span>}
            {video.duration_seconds != null && (
              <span className="shrink-0 tabular-nums">{formatTime(video.duration_seconds, { ms: false })}</span>
            )}
          </div>
        </div>
        <span
          className="hidden shrink-0 text-xs text-muted-foreground sm:inline"
          title={new Date(video.annotated_at).toLocaleString()}
        >
          {formatRelative(video.annotated_at)}
        </span>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </Link>
      <div className="shrink-0 px-4">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" variant="outline" onClick={done} disabled={finish.isPending}>
              {finish.isPending ? <Spinner /> : <CheckCheck />} Done
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Reviewed, no changes needed: remove it from this list (it stays in the queue).
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

function NotSetUp({ project }: { project: Project }) {
  const options = reviewFieldOptions(project.label_schema);
  const stale = project.settings.coach_review_field;
  const [title, description, section, action] =
    options.length === 0
      ? [
          "Add a review field",
          "Add a whole-video field such as “Flagged for Review” to the label schema: a choice with true / false options, or a checkbox.",
          "schema",
          "Edit label schema",
        ]
      : stale
        ? [
            "Choose a new coach review field",
            `The chosen field “${stale}” is no longer in the label schema (or can no longer flag a video).`,
            "general",
            "Open settings",
          ]
        : [
            "Choose the coach review field",
            "No whole-video field has “review” in its name. Pick the one that flags videos in Settings > General.",
            "general",
            "Open settings",
          ];
  return (
    <Empty className="border py-20">
      <EmptyHeader>
        <EmptyMedia variant="icon">{section === "schema" ? <Tags /> : <Settings2 />}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild>
          <Link href={`/projects/${project.id}/settings?section=${section}`}>
            <Settings2 /> {action}
          </Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}

function ReviewListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-16 rounded-xl" />
      ))}
    </div>
  );
}

export function ReviewSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <Skeleton className="mb-6 h-12 w-64" />
      <ReviewListSkeleton />
    </div>
  );
}
