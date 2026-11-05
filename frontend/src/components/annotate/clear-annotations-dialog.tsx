"use client";

import { useState } from "react";

import { VideoNames } from "@/components/annotate/remove-video-dialog";
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

/** Confirms clearing the annotations of one or more videos (right-click, or a selection in the queue). */
export function ClearAnnotationsDialog({
  videos,
  eventCount,
  onOpenChange,
  onConfirm,
}: {
  videos: VideoItem[] | null;
  /** Events that will be removed (saved, plus unsaved ones on the active video). */
  eventCount: number;
  onOpenChange: (open: boolean) => void;
  onConfirm: (videos: VideoItem[]) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const list = videos ?? [];
  const many = list.length > 1;
  const saved = list.some((v) => v.status !== "not_started");
  const events = `${eventCount} event${eventCount === 1 ? "" : "s"}`;

  return (
    <AlertDialog open={videos !== null} onOpenChange={(open) => !pending && onOpenChange(open)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {many ? `Clear annotations of ${list.length} videos?` : "Clear annotations?"}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              {many ? (
                <>
                  <p>
                    These videos will go back to <span className="font-medium text-foreground">not started</span>, and
                    their {events} will be removed:
                  </p>
                  <VideoNames videos={list} />
                </>
              ) : (
                <p>
                  <span className="font-medium break-all text-foreground">{list[0]?.filename}</span> will go back to{" "}
                  <span className="font-medium text-foreground">not started</span> and its {events} will be removed.
                </p>
              )}
              {saved && (
                <p>
                  This applies for everyone working on the project. The saved copies are kept in Lemon&apos;s trash, so
                  they can still be recovered. The videos in S3 are not touched.
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button
            disabled={pending}
            className="bg-destructive text-white hover:bg-destructive/90 dark:bg-destructive/90 dark:hover:bg-destructive"
            onClick={async () => {
              if (!list.length) return;
              setPending(true);
              try {
                await onConfirm(list);
                onOpenChange(false);
              } catch {
                /* error toast already shown; keep the dialog open so the user can retry */
              } finally {
                setPending(false);
              }
            }}
          >
            {pending && <Spinner />} Clear annotations
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
