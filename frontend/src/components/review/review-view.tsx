"use client";

import { ArrowRight, CheckCheck, Play } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useFinishReview } from "@/hooks/queries";
import { errorMessage } from "@/lib/api";
import { formatRelative, formatTime } from "@/lib/format";
import type { ReviewVideo } from "@/lib/types";

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
