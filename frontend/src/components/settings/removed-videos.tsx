"use client";

import { RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useRestoreVideo } from "@/hooks/queries";
import { errorMessage } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import type { Project } from "@/lib/types";

/** Videos deleted from the queue ("Delete video"), with a way to bring each one back. Hidden when none. */
export function RemovedVideos({ project }: { project: Project }) {
  const restore = useRestoreVideo(project.id);
  const removed = project.removed_videos;
  if (removed.length === 0) return null;

  const restoreOne = (key: string) =>
    restore.mutate(key, {
      onSuccess: () => toast.success(`${key.split("/").pop()} is back in the queue`),
      onError: (err) => {
        const { title, hint } = errorMessage(err);
        toast.error(`Couldn't restore the video: ${title}`, { description: hint ?? undefined });
      },
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deleted videos</CardTitle>
        <CardDescription>
          Taken out of the queue and the export. Their files are still in S3; restoring puts a video back in the queue
          (its cleared annotations stay cleared).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y rounded-lg border">
          {removed.map((r) => {
            const pending = restore.isPending && restore.variables === r.key;
            return (
              <li key={r.key} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium" title={r.key}>
                    {r.key.split("/").pop()}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    Deleted {r.removed_by ? `by ${r.removed_by} ` : ""}
                    {formatRelative(r.removed_at)}
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => restoreOne(r.key)} disabled={restore.isPending}>
                  {pending ? <Spinner /> : <RotateCcw />} Restore
                </Button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
