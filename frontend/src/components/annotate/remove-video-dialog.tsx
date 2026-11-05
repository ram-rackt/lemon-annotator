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

const SHOWN = 5;

/** The first few file names of a selection, then "and N more". */
export function VideoNames({ videos }: { videos: VideoItem[] }) {
  return (
    <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border bg-muted/40 px-3 py-2 text-xs">
      {videos.slice(0, SHOWN).map((v) => (
        <li key={v.key} className="truncate font-medium text-foreground" title={v.key}>
          {v.filename}
        </li>
      ))}
      {videos.length > SHOWN && <li className="text-muted-foreground">and {videos.length - SHOWN} more</li>}
    </ul>
  );
}

/** Confirms deleting one or more videos from the project (right-click, or a selection in the queue). */
export function RemoveVideoDialog({
  videos,
  eventCount,
  onOpenChange,
  onConfirm,
}: {
  videos: VideoItem[] | null;
  /** Events that will be cleared (saved, plus unsaved ones on the active video). */
  eventCount: number;
  onOpenChange: (open: boolean) => void;
  onConfirm: (videos: VideoItem[]) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const list = videos ?? [];
  const many = list.length > 1;
  const events = eventCount > 0 && (
    <>
      , and {many ? "their" : "its"} {eventCount} event{eventCount === 1 ? "" : "s"} will be cleared
    </>
  );

  return (
    <AlertDialog open={videos !== null} onOpenChange={(open) => !pending && onOpenChange(open)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{many ? `Delete ${list.length} videos?` : "Delete this video?"}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              {many ? (
                <>
                  <p>
                    These videos will be removed from the queue and the export for everyone working on this project
                    {events}:
                  </p>
                  <VideoNames videos={list} />
                </>
              ) : (
                <p>
                  <span className="font-medium break-all text-foreground">{list[0]?.filename}</span> will be removed
                  from the queue and the export for everyone working on this project{events}.
                </p>
              )}
              <p>
                The {many ? "files stay" : "file stays"} in your S3 bucket. You can bring {many ? "them" : "it"} back
                any time under Settings &gt; General.
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
            {pending && <Spinner />} {many ? `Delete ${list.length} videos` : "Delete video"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
