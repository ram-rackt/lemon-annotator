"use client";

import { useState } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { VideoItem } from "@/lib/types";

export function RemoveVideoDialog({
  video,
  eventCount,
  onOpenChange,
  onConfirm,
}: {
  video: VideoItem | null;
  /** Events that will be cleared (saved, plus unsaved ones when this is the active video). */
  eventCount: number;
  onOpenChange: (open: boolean) => void;
  onConfirm: (video: VideoItem) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);

  return (
    <AlertDialog open={video !== null} onOpenChange={(open) => !pending && onOpenChange(open)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove this video?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                <span className="font-medium break-all text-foreground">{video?.filename}</span> will be removed from
                the queue and the export for everyone working on this project
                {eventCount > 0 && (
                  <>
                    , and its {eventCount} event{eventCount === 1 ? "" : "s"} will be cleared
                  </>
                )}
                .
              </p>
              <p>
                The file stays in your S3 bucket. You can bring the video back any time under Settings &gt; General.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button
            disabled={pending}
            className="bg-destructive text-white hover:bg-destructive/90 dark:bg-destructive/90 dark:hover:bg-destructive"
            onClick={async () => {
              if (!video) return;
              setPending(true);
              try {
                await onConfirm(video);
                onOpenChange(false);
              } catch {
                /* error toast already shown; keep the dialog open so the user can retry */
              } finally {
                setPending(false);
              }
            }}
          >
            {pending && <Spinner />} Remove video
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
