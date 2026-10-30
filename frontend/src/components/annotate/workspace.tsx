"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  CheckCheck,
  ChevronDown,
  ChevronUp,
  CloudOff,
  ExternalLink,
  Flag,
  FolderSearch,
  Keyboard,
  Settings2,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { ClearAnnotationsDialog } from "@/components/annotate/clear-annotations-dialog";
import { EventList, LabelsSummary } from "@/components/annotate/event-list";
import { QueueRail, TagRail } from "@/components/annotate/panel-rails";
import { ShortcutsDialog } from "@/components/annotate/shortcuts-dialog";
import { type PanelPrefs, TaggingPanel } from "@/components/annotate/tagging-panel";
import { VideoDetailsDialog } from "@/components/annotate/video-details-dialog";
import { RemoveVideoDialog } from "@/components/annotate/remove-video-dialog";
import { VideoQueue } from "@/components/annotate/video-queue";
import { type PlayerHandle, VideoPlayer } from "@/components/annotate/video-player";
import { ErrorState } from "@/components/error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useHydrated } from "@/hooks/use-hydrated";
import {
  invalidateReview,
  keys,
  streamUrlQuery,
  useActivity,
  useRestoreVideo,
  useAnnotation,
  useProject,
  useSaveAnnotation,
  useStreamUrl,
  useVideos,
} from "@/hooks/queries";
import { api, ApiError, errorMessage, isConflict } from "@/lib/api";
import { eventColor } from "@/lib/colors";
import { formatTime, frameAt, joinNames, newId } from "@/lib/format";
import { pendingSave } from "@/lib/pending-save";
import {
  type DraftValues,
  emptyDraft,
  hotkeyTargets,
  missingRequired,
  draftHasValues,
  draftValue,
  hasEventSection,
  missingRequiredLabels,
  reconcileDraft,
  clearedValue,
  formatValue,
  isFlagged,
  reviewField,
  setDraftValue,
  toggledValue,
  withLabelDefaults,
} from "@/lib/schema";
import { createTimeStore } from "@/lib/time-store";
import type {
  AnnotationEvent,
  LabelValue,
  Project,
  StreamUrl,
  VideoAnnotation,
  VideoItem,
  VideoList,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Gate: project → storage → video list                                       */
/* -------------------------------------------------------------------------- */

export function AnnotateWorkspace() {
  const { projectId } = useParams<{ projectId: string }>();
  const searchParams = useSearchParams();
  const hydrated = useHydrated();
  const projectQ = useProject(projectId);
  // Render data only after hydration so the first client render matches the server HTML.
  const project = hydrated ? projectQ.data : undefined;
  const configured = Boolean(project?.storage.is_configured);
  const videosQ = useVideos(projectId, configured);
  const list = videosQ.data;

  // Once the workspace has been shown it stays mounted: replacing it with an error or empty screen
  // because a background refresh failed would throw away unsaved events.
  const [workspaceShown, setWorkspaceShown] = useState(false);
  if (list && list.videos.length > 0 && !workspaceShown) setWorkspaceShown(true);

  // A failed refresh while data is on screen is reported, not rendered as a full-page error.
  useEffect(() => {
    if (!videosQ.errorUpdatedAt || !videosQ.data || !videosQ.error) return;
    const { title, hint } = errorMessage(videosQ.error);
    toast.error(`Couldn't refresh the queue: ${title}`, { description: hint ?? undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per failed refresh
  }, [videosQ.errorUpdatedAt]);

  if (!hydrated || projectQ.isPending) return <WorkspaceSkeleton />;
  if (!project) return <ErrorState className="h-full" error={projectQ.error} onRetry={() => projectQ.refetch()} />;

  const settingsLink = (
    <Button asChild size="sm" variant="outline">
      <Link href={`/projects/${projectId}/settings`}>
        <Settings2 /> Open settings
      </Link>
    </Button>
  );

  if (!configured && !workspaceShown) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CloudOff />
          </EmptyMedia>
          <EmptyTitle>Connect your S3 bucket</EmptyTitle>
          <EmptyDescription>Add your bucket, folder prefix and credentials to load the video queue.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild>
            <Link href={`/projects/${projectId}/settings`}>
              <Settings2 /> Configure storage
            </Link>
          </Button>
        </EmptyContent>
      </Empty>
    );
  }
  if (!list) {
    if (videosQ.error)
      return (
        <ErrorState className="h-full" error={videosQ.error} onRetry={() => videosQ.refetch()} action={settingsLink} />
      );
    return <WorkspaceSkeleton />;
  }
  if (list.videos.length === 0 && !workspaceShown && project.access === "coach") {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Flag />
          </EmptyMedia>
          <EmptyTitle>Nothing to review here</EmptyTitle>
          <EmptyDescription>No videos in {project.name} are flagged for coach review right now.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild size="sm" variant="outline">
            <Link href="/review">Coach review</Link>
          </Button>
        </EmptyContent>
      </Empty>
    );
  }
  if (list.videos.length === 0 && !workspaceShown) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderSearch />
          </EmptyMedia>
          <EmptyTitle>No videos found</EmptyTitle>
          <EmptyDescription>
            No .mp4 or .mov files under{" "}
            <code className="font-mono">
              s3://{list.bucket}/{list.prefix}
            </code>
            .
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row justify-center">
          <Button size="sm" variant="outline" onClick={() => videosQ.refetch()} disabled={videosQ.isFetching}>
            {videosQ.isFetching && <Spinner />} Re-scan
          </Button>
          {settingsLink}
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <Workspace
      project={project}
      list={list}
      refreshing={videosQ.isFetching}
      onRefresh={() => videosQ.refetch()}
      initialKey={searchParams.get("v")}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const sortEvents = (evs: AnnotationEvent[]) =>
  [...evs].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Next video that still needs work, searching forward from `current` and wrapping. */
function findNextTodo(videos: VideoItem[], current: string | null): string | null {
  const i = videos.findIndex((v) => v.key === current);
  const order = [...videos.slice(i + 1), ...videos.slice(0, Math.max(i, 0))];
  return order.find((v) => v.status !== "completed" && !v.missing)?.key ?? null;
}

const lastVideoKey = (projectId: string) => `lemon.last-video.${projectId}`;

function readLastVideo(projectId: string): string | null {
  try {
    return localStorage.getItem(lastVideoKey(projectId));
  } catch {
    return null;
  }
}

/** Autosave this long after the last change. */
const AUTOSAVE_MS = 1200;

/** A cached copy of a video's annotations older than this is re-checked when the video is opened. */
const RECHECK_AFTER_MS = 10_000;

/** The saved copy the editor's content is based on: what a save says it started from. */
interface SavedBase {
  key: string;
  revision: string | null;
  /** Server time of that save (null: nothing saved). Activity snapshots older than this are stale. */
  savedAt: string | null;
}

const baseOf = (key: string, data: VideoAnnotation | null | undefined): SavedBase => ({
  key,
  revision: data?.revision ?? null,
  savedAt: data?.updated_at ?? null,
});

function pickInitial(videos: VideoItem[], requested: string | null): string | null {
  if (requested && videos.some((v) => v.key === requested)) return requested;
  return videos.find((v) => v.status !== "completed" && !v.missing)?.key ?? videos[0]?.key ?? null;
}

function describeMediaError(err: MediaError | null): string {
  switch (err?.code) {
    case MediaError.MEDIA_ERR_NETWORK:
      return "A network error interrupted streaming from S3.";
    case MediaError.MEDIA_ERR_DECODE:
      return "The video could not be decoded. It may be corrupt or use a codec your browser can't play.";
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "This browser can't play this file. MP4/MOV must be encoded with H.264 (HEVC/H.265 and ProRes won't play in most browsers), or S3 refused access to the object.";
    default:
      return "Playback failed.";
  }
}

/* Workspace preferences persisted per browser: tagging behaviour + which side panels are open. */
interface WorkspacePrefs extends PanelPrefs {
  queueOpen: boolean;
  panelOpen: boolean;
}
const PREFS_KEY = "lemon.workspace-prefs";
const DEFAULT_PREFS: WorkspacePrefs = { pauseOnCapture: false, keepValues: false, queueOpen: true, panelOpen: true };
const prefListeners = new Set<() => void>();
let prefCache: WorkspacePrefs | null = null;
const prefsStore = {
  read(): WorkspacePrefs {
    if (prefCache) return prefCache;
    try {
      prefCache = { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") };
    } catch {
      prefCache = DEFAULT_PREFS;
    }
    return prefCache!;
  },
  write(p: WorkspacePrefs) {
    prefCache = p;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(p));
    } catch {
      /* private mode */
    }
    prefListeners.forEach((l) => l());
  },
  subscribe(fn: () => void) {
    prefListeners.add(fn);
    return () => prefListeners.delete(fn);
  },
};

/* -------------------------------------------------------------------------- */
/* Workspace                                                                  */
/* -------------------------------------------------------------------------- */

function Workspace({
  project,
  list,
  refreshing,
  onRefresh,
  initialKey,
}: {
  project: Project;
  list: VideoList;
  refreshing: boolean;
  onRefresh: () => void;
  initialKey: string | null;
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const projectId = project.id;
  const schema = project.label_schema;
  const { fps, skip_seconds: skipSeconds } = project.settings;
  const videos = list.videos;

  const playerRef = useRef<PlayerHandle>(null);
  const [timeStore] = useState(createTimeStore);
  const prefs = useSyncExternalStore(prefsStore.subscribe, prefsStore.read, () => DEFAULT_PREFS);

  const [activeKey, setActiveKey] = useState<string | null>(() =>
    pickInitial(videos, initialKey ?? readLastVideo(project.id)),
  );
  const activeKeyRef = useRef(activeKey);
  useEffect(() => {
    activeKeyRef.current = activeKey;
  }, [activeKey]);

  const urlQ = useStreamUrl(projectId, activeKey);
  const annQ = useAnnotation(projectId, activeKey);
  const saveMut = useSaveAnnotation(projectId);
  const activityQ = useActivity(projectId, activeKey);
  const activity = activityQ.data;

  // Local, editable copy of the active video's events.
  const [events, setEvents] = useState<AnnotationEvent[]>([]);
  // Whole-video answers, saved with the video (as opposed to per-timestamp events).
  const [labels, setLabels] = useState<Record<string, LabelValue>>({});
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const versionRef = useRef(0);
  /** versionRef value covered by the last successful save (nothing newer to write when equal). */
  const savedVersionRef = useRef(0);
  const [contentVersion, setContentVersion] = useState(0);
  /** The saved copy the editor is based on. Saves send its revision; the server refuses outdated ones. */
  const baseRef = useRef<SavedBase | null>(null);
  const [adopted, setAdopted] = useState<SavedBase | null>(null);

  const [draft, setDraft] = useState<DraftValues>(() => emptyDraft(schema));
  const [draftSchema, setDraftSchema] = useState(schema);
  if (draftSchema !== schema) {
    // The schema was edited in Settings: drop values for removed fields / event types.
    setDraftSchema(schema);
    setDraft((d) => reconcileDraft(d, schema));
  }
  const [editingId, setEditingId] = useState<string | null>(null);
  const [preEditDraft, setPreEditDraft] = useState<DraftValues | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showRequired, setShowRequired] = useState(false);
  const [showRequiredLabels, setShowRequiredLabels] = useState(false);
  const [detailsVideo, setDetailsVideo] = useState<VideoItem | null>(null);
  const [clearVideo, setClearVideo] = useState<VideoItem | null>(null);
  const [removeVideo, setRemoveVideo] = useState<VideoItem | null>(null);
  const restoreMut = useRestoreVideo(projectId);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const lastRefresh = useRef<{ key: string; at: number } | null>(null);

  // Adopt server data once per video switch (derived-state pattern, no effect needed).
  if (activeKey && annQ.isSuccess && loadedKey !== activeKey) {
    setLoadedKey(activeKey);
    setAdopted(baseOf(activeKey, annQ.data));
    setEvents(sortEvents(annQ.data?.events ?? []));
    setLabels(withLabelDefaults(schema, annQ.data?.labels));
    setDirty(false);
    setShowRequiredLabels(false);
    setEditingId(null);
    setPreEditDraft(null);
  }
  // Before any save can run (layout effects run ahead of timers and user input).
  useLayoutEffect(() => {
    if (adopted) baseRef.current = adopted;
  }, [adopted]);
  const ready = Boolean(activeKey) && loadedKey === activeKey;
  const activeVideo = videos.find((v) => v.key === activeKey) ?? null;
  const editingIndex = editingId ? events.findIndex((e) => e.id === editingId) : -1;
  const editing = editingIndex >= 0 ? { event: events[editingIndex], index: editingIndex } : null;

  /** Count a content change. The state copy is rendered together with `events`/`labels`, so a save can
   * record exactly which version its content is (versionRef alone may already be ahead of a render). */
  const bumpVersion = () => {
    versionRef.current++;
    setContentVersion(versionRef.current);
  };

  const mutateEvents = (fn: (prev: AnnotationEvent[]) => AnnotationEvent[]) => {
    setEvents((prev) => sortEvents(fn(prev)));
    setDirty(true);
    bumpVersion();
  };

  const changeLabels = (next: Record<string, LabelValue>) => {
    setLabels(next);
    setDirty(true);
    bumpVersion();
  };
  const withEvents = hasEventSection(schema);
  const coachField = reviewField(schema, project.settings.coach_review_field);
  // A coach from another workspace: the queue holds only flagged videos, and storage stays hidden.
  const coachView = project.access === "coach";

  /* ------------------------------ switching ------------------------------ */

  const doSwitch = (key: string) => {
    // Drop a cached presigned URL that is about to expire rather than flash an old one.
    const cached = qc.getQueryData<StreamUrl>(keys.streamUrl(projectId, key));
    if (cached && new Date(cached.expires_at).getTime() - Date.now() < 3 * 60_000) {
      qc.removeQueries({ queryKey: keys.streamUrl(projectId, key) });
    }
    // A copy cached a while ago (e.g. prefetched for Save & Next) may be outdated: show it, but re-check.
    const saved = qc.getQueryState(keys.annotation(projectId, key));
    if (saved?.dataUpdatedAt && Date.now() - saved.dataUpdatedAt > RECHECK_AFTER_MS) {
      qc.invalidateQueries({ queryKey: keys.annotation(projectId, key) });
    }
    setActiveKey(key);
    setLoadedKey(null);
    setEvents([]);
    setLabels({});
    setShowRequiredLabels(false);
    setEditingId(null);
    setPreEditDraft(null);
    setMediaError(null);
    setDirty(false);
    setShowRequired(false);
    if (!prefs.keepValues) setDraft(emptyDraft(schema));
    window.history.replaceState(null, "", `?v=${encodeURIComponent(key)}`);
  };

  /** Switching never discards work: pending changes are saved first (and stay put if that fails). */
  const requestSwitch = async (key: string) => {
    if (key === activeKey) return;
    if (dirty && ready) {
      try {
        await save("save");
      } catch {
        return; // the error toast is already shown; stay on this video
      }
    }
    doSwitch(key);
  };

  const goRelative = (dir: 1 | -1) => {
    const i = videos.findIndex((v) => v.key === activeKey);
    const next = videos[i + dir];
    if (next) requestSwitch(next.key);
  };

  // Warm up the next video so Save & Next is instant.
  useEffect(() => {
    const next = findNextTodo(videos, activeKey);
    if (!next) return;
    qc.prefetchQuery(streamUrlQuery(projectId, next));
    qc.prefetchQuery({
      queryKey: keys.annotation(projectId, next),
      queryFn: () => api.getAnnotation(projectId, next),
      staleTime: Infinity,
    });
  }, [activeKey, videos, projectId, qc]);

  /* -------------------------------- saving ------------------------------- */

  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  /** Saves run one after another, in the order they were requested. Each one sends the content as it
   * was when requested, together with that content's version, so a queued save can never mark newer
   * edits (made while it waited) as saved. `withLabels` saves labels changed in the same event handler:
   * they aren't rendered yet, so their version is the one just counted. */
  const save = (mode: "save" | "complete", withLabels?: Record<string, LabelValue>) => {
    const snapshot = withLabels
      ? { version: versionRef.current, events, labels: withLabels }
      : { version: contentVersion, events, labels };
    const run = saveChain.current.then(
      () => saveNow(mode, snapshot),
      () => saveNow(mode, snapshot),
    );
    saveChain.current = run.catch(() => {});
    return run;
  };

  const saveNow = async (
    mode: "save" | "complete",
    { version, events, labels }: { version: number; events: AnnotationEvent[]; labels: Record<string, LabelValue> },
  ) => {
    const key = activeKeyRef.current;
    if (!key || loadedKey !== key) return null;
    // Plain saves with nothing new are skipped (autosave may fire after an explicit save).
    if (mode === "save" && version === savedVersionRef.current) return null;
    // Status from the latest saved copy, never a stale render: a queued autosave must not demote
    // a video that Save & Next just marked completed.
    const previous = qc.getQueryData<VideoAnnotation | null>(keys.annotation(projectId, key))?.status;
    const status = mode === "complete" || previous === "completed" ? "completed" : "in_progress";
    const url = urlQ.data?.key === key ? urlQ.data : undefined;
    const base = baseRef.current?.key === key ? baseRef.current : null;
    try {
      const saved = await saveMut.mutateAsync({
        key,
        body: {
          status,
          events,
          labels,
          streaming_url: url?.url ?? null,
          streaming_url_expires_at: url?.expires_at ?? null,
          duration_seconds: playerRef.current?.getDuration() || null,
          base_revision: base?.revision ?? null,
        },
      });
      if (activeKeyRef.current === key) baseRef.current = baseOf(key, saved);
      // Only mark clean if nothing changed while the request was in flight.
      savedVersionRef.current = Math.max(savedVersionRef.current, version);
      if (versionRef.current === version && activeKeyRef.current === key) {
        setEvents(sortEvents(saved.events));
        setLabels(withLabelDefaults(schema, saved.labels));
        setDirty(false);
        // Directly, not via the effect: effects don't run while this view is hidden, and a stale
        // registration would make the browser warn about work that is already saved.
        pendingSave.register(projectId, null);
      }
      return saved;
    } catch (err) {
      if (isConflict(err)) {
        showConflict(key, err);
      } else {
        const { title, hint } = errorMessage(err);
        toast.error(`Save failed: ${title}`, { description: hint ?? undefined });
      }
      throw err;
    }
  };

  /* ------------------------- shared editing (conflicts) ------------------------ */

  /** Replace the editor's content with a saved copy (someone else's newer save, or a reload). */
  const adoptServerCopy = (key: string, data: VideoAnnotation | null) => {
    if (editingId) {
      // The edited event may have changed or gone: leave edit mode and restore the capture values.
      setEditingId(null);
      setShowRequired(false);
      setDraft(preEditDraft ?? emptyDraft(schema));
      setPreEditDraft(null);
    }
    setEvents(sortEvents(data?.events ?? []));
    setLabels(withLabelDefaults(schema, data?.labels));
    setDirty(false);
    baseRef.current = baseOf(key, data);
    // Nothing left to save: an autosave queued for the replaced content must not write it back.
    bumpVersion();
    savedVersionRef.current = versionRef.current;
    pendingSave.register(projectId, null);
  };

  /** "Load theirs": discard local edits and show the saved copy. */
  const loadServerCopy = async (key: string) => {
    try {
      const data = await qc.fetchQuery({
        queryKey: keys.annotation(projectId, key),
        queryFn: () => api.getAnnotation(projectId, key),
        staleTime: 0,
      });
      if (activeKeyRef.current !== key) return;
      adoptRef.current(key, data);
      toast.success("Loaded the saved version", { duration: 2000 });
    } catch (err) {
      const { title, hint } = errorMessage(err);
      toast.error(`Couldn't load it: ${title}`, { description: hint ?? undefined });
    }
  };

  /** "Keep mine": save the local edits on top of the copy that was saved meanwhile. */
  const keepMine = (key: string, revision: string | null, savedAt: string | null) => {
    if (activeKeyRef.current !== key) {
      toast.error("Switch back to that video to keep your changes.");
      return;
    }
    baseRef.current = { key, revision, savedAt };
    saveRef
      .current("save")
      .then((s) => s && toast.success("Saved your version", { duration: 2000 }))
      .catch(() => {});
  };

  const showConflict = (key: string, err: ApiError) => {
    const d = err.details as { revision?: string | null; updated_at?: string | null; cleared?: boolean };
    toast.error(err.message, {
      id: `conflict:${key}`,
      description: d.cleared
        ? "Your changes are not saved. Keep them to save them again, or reload the cleared video."
        : "Your changes are not saved. Load their version (yours are discarded), or keep yours (replaces theirs).",
      duration: Infinity,
      action: { label: d.cleared ? "Reload" : "Load theirs", onClick: () => void loadServerCopy(key) },
      cancel: { label: "Keep mine", onClick: () => keepMine(key, d.revision ?? null, d.updated_at ?? null) },
    });
  };

  const saveOnly = () => {
    if (!ready) return;
    save("save")
      .then((s) =>
        s
          ? toast.success("Saved", { description: s.video_filename })
          : toast.success("Already saved", { description: "Changes are saved automatically.", duration: 1500 }),
      )
      .catch(() => {});
  };

  const saveAndNext = async () => {
    if (!ready) return;
    const missingLabels = missingRequiredLabels(schema, labels);
    if (missingLabels.length) {
      setShowRequiredLabels(true);
      toast.error(`Fill in required field${missingLabels.length === 1 ? "" : "s"} first`, {
        description: missingLabels.map((f) => f.label).join(", "),
      });
      return;
    }
    // Per-timestamp selections only count once captured. Don't let them vanish silently.
    if (withEvents && !editingId && events.length === 0 && draftHasValues(draft, schema)) {
      toast.error("These timestamp values haven't been captured yet", {
        description: "Press Enter (Capture) to record them at the current time, or discard them.",
        action: { label: "Discard", onClick: () => setDraft(emptyDraft(schema)) },
      });
      return;
    }
    const current = activeKeyRef.current;
    const version = versionRef.current;
    try {
      const saved = await save("complete");
      if (!saved) return;
    } catch {
      return;
    }
    if (activeKeyRef.current !== current) return;
    if (versionRef.current !== version) {
      toast.info("Saved. You made changes while saving, so you're still on this video.");
      return;
    }
    const latest = qc.getQueryData<VideoList>(keys.videos(projectId))?.videos ?? videos;
    const next = findNextTodo(latest, current);
    if (next) {
      doSwitch(next);
      toast.success("Saved — next video", { duration: 1500 });
    } else {
      toast.success("All videos in this queue are completed", {
        description: "Use Export Project JSON to write the final file.",
      });
    }
  };

  /** Coach review: clear this video's flag (saving any changes made too), then open the next flagged video. */
  const finishReview = async () => {
    if (!ready || !coachField) return;
    const current = activeKeyRef.current;
    const next = { ...labels, [coachField.key]: clearedValue(coachField) };
    changeLabels(next);
    const version = versionRef.current;
    try {
      if (!(await save("save", next))) return;
    } catch {
      return; // the error (or conflict) toast is already shown
    }
    // A coach's queue is the flagged videos, so this one leaves it.
    if (coachView) qc.invalidateQueries({ queryKey: keys.videos(projectId) });
    if (activeKeyRef.current !== current || versionRef.current !== version) return;
    let flagged: string[] = [];
    try {
      const list = await qc.fetchQuery({
        queryKey: keys.review(projectId),
        queryFn: () => api.reviewVideos(projectId),
        staleTime: 0,
      });
      flagged = list.videos.map((v) => v.key).filter((k) => k !== current && videos.some((v) => v.key === k));
    } catch {
      /* the review is saved; just don't move on */
    }
    if (activeKeyRef.current !== current) return;
    if (flagged[0]) {
      doSwitch(flagged[0]);
      toast.success("Review done — next flagged video", { duration: 2000 });
    } else if (coachView) {
      // Nothing else here the coach may open: back to the list of every project.
      toast.success("Review done", { description: "No other videos in this project are flagged for review." });
      router.push("/review");
    } else {
      toast.success("Review done", {
        description: "No other videos in this project are flagged for review.",
        action: { label: "Coach review", onClick: () => router.push("/review") },
      });
    }
  };

  // Autosave: write changes to disk shortly after the last edit, so work persists until it is
  // cleared on purpose. A ref keeps the timer from restarting on unrelated re-renders.
  const saveRef = useRef(save);
  const flushRef = useRef<() => void>(() => {});
  const adoptRef = useRef(adoptServerCopy);
  const switchRef = useRef(requestSwitch);
  const finishReviewRef = useRef(finishReview);
  useEffect(() => {
    saveRef.current = save;
    adoptRef.current = adoptServerCopy;
    switchRef.current = requestSwitch;
    finishReviewRef.current = finishReview;
    flushRef.current = () => {
      if (dirty && ready) save("save").catch(() => {});
    };
  });

  // This view stays mounted (hidden) while another tab of the app is open, so opening a video from
  // there (e.g. Coach review) arrives as a new ?v= rather than a fresh mount. Our own switches set ?v=
  // to the active video, so they don't trigger this.
  useEffect(() => {
    if (initialKey && initialKey !== activeKeyRef.current && videos.some((v) => v.key === initialKey)) {
      void switchRef.current(initialKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the requested video changes
  }, [initialKey]);

  // Someone else saved (or cleared) the open video and it was re-read: take their copy, unless there
  // are local edits, including an event being edited (saving those will then ask which version to
  // keep; leaving edit mode lets this run again).
  useEffect(() => {
    const base = baseRef.current;
    const data = annQ.data;
    if (!ready || !activeKey || data === undefined || base?.key !== activeKey) return;
    if ((data?.revision ?? null) === base.revision || dirty || editingId || saveMut.isPending) return;
    // A read that started before this tab's own latest save can finish after it: never go back in time.
    if (data && base.savedAt && new Date(data.updated_at).getTime() < new Date(base.savedAt).getTime()) return;
    adoptRef.current(activeKey, data);
    toast.info(
      data
        ? `Updated with ${data.updated_by ?? "someone else"}'s latest save`
        : "Someone cleared this video's annotations",
      { duration: 4000 },
    );
  }, [annQ.data, activeKey, ready, dirty, editingId, saveMut.isPending]);

  // The heartbeat says the open video changed on the server: re-read it (the effect above applies it).
  useEffect(() => {
    const base = baseRef.current;
    if (!activity || !ready || !activeKey || dirty || base?.key !== activeKey) return;
    // A snapshot taken before the copy on screen was saved can't tell anything new.
    if (base.savedAt && new Date(activity.as_of).getTime() < new Date(base.savedAt).getTime()) return;
    if ((activity.videos[activeKey]?.revision ?? null) !== base.revision) {
      qc.invalidateQueries({ queryKey: keys.annotation(projectId, activeKey) });
    }
  }, [activity, activeKey, ready, dirty, projectId, qc]);
  useEffect(() => {
    if (!dirty || !ready) return;
    const id = setTimeout(() => saveRef.current("save").catch(() => {}), AUTOSAVE_MS);
    return () => clearTimeout(id);
  }, [dirty, ready, events, labels]);
  // Leaving the Annotate view (another tab of the app) or unmounting saves immediately.
  useEffect(() => () => flushRef.current(), []);

  // Remember where the user was, per project.
  useEffect(() => {
    if (!activeKey) return;
    try {
      localStorage.setItem(lastVideoKey(projectId), activeKey);
    } catch {
      /* private mode */
    }
  }, [activeKey, projectId]);

  // Export (header) saves pending edits first, and closing the tab warns about them. Registered
  // without a cleanup on purpose: it must stay active while this route is hidden behind Settings.
  useEffect(() => {
    pendingSave.register(projectId, dirty ? () => save("save") : null);
  });

  /* ------------------------------- events -------------------------------- */

  const fullValues = (d: DraftValues): DraftValues => {
    const r = reconcileDraft(d, schema);
    return { ...r, note: r.note.trim() };
  };

  /** True when every required field has a value; otherwise highlights them and explains why. */
  const requiredFilled = () => {
    const missing = missingRequired(schema, fullValues(draft));
    if (!missing.length) {
      setShowRequired(false);
      return true;
    }
    setShowRequired(true);
    toast.error(`Fill in required field${missing.length === 1 ? "" : "s"} first`, {
      description: missing.map((f) => f.label).join(", "),
    });
    return false;
  };

  const capture = () => {
    if (!ready || !urlQ.data || mediaError) {
      toast.error("Load a video before capturing timestamps.");
      return;
    }
    if (!requiredFilled()) return;
    const player = playerRef.current;
    if (!player) return;
    if (prefs.pauseOnCapture) player.pause();
    const t = player.getTime();
    const ev: AnnotationEvent = { id: newId(), timestamp: round3(t), frame: frameAt(t, fps), ...fullValues(draft) };
    mutateEvents((prev) => [...prev, ev]);
    setFlashId(ev.id);
    setDraft(prefs.keepValues ? { ...draft, note: "" } : emptyDraft(schema));
  };

  const startEdit = (ev: AnnotationEvent) => {
    if (!editingId) setPreEditDraft(draft);
    setEditingId(ev.id);
    setDraft({
      event_name: ev.event_name,
      checkboxes: { ...ev.checkboxes },
      attributes: { ...ev.attributes },
      note: ev.note,
    });
    playerRef.current?.pause();
    playerRef.current?.seek(ev.timestamp);
  };

  const exitEdit = () => {
    setEditingId(null);
    setShowRequired(false);
    setDraft(preEditDraft ?? emptyDraft(schema));
    setPreEditDraft(null);
  };

  const updateEvent = () => {
    if (!editingId || !requiredFilled()) return;
    const id = editingId;
    const values = fullValues(draft);
    // Merge over the stored event so values for fields no longer in the schema are kept.
    mutateEvents((prev) =>
      prev.map((e) =>
        e.id === id
          ? {
              ...e,
              event_name: values.event_name,
              note: values.note,
              checkboxes: { ...e.checkboxes, ...values.checkboxes },
              attributes: { ...e.attributes, ...values.attributes },
            }
          : e,
      ),
    );
    setFlashId(id);
    exitEdit();
  };

  const retime = () => {
    if (!editingId || !playerRef.current) return;
    const t = playerRef.current.getTime();
    const id = editingId;
    mutateEvents((prev) => prev.map((e) => (e.id === id ? { ...e, timestamp: round3(t), frame: frameAt(t, fps) } : e)));
    toast.success(`Moved to ${formatTime(t)}`, { duration: 1500 });
  };

  const deleteEvent = (ev: AnnotationEvent) => {
    const key = activeKey;
    mutateEvents((prev) => prev.filter((e) => e.id !== ev.id));
    if (editingId === ev.id) exitEdit();
    toast(`Deleted event at ${formatTime(ev.timestamp)}`, {
      action: {
        label: "Undo",
        onClick: () => {
          if (activeKeyRef.current !== key) toast.error("Switch back to that video to undo.");
          else mutateEvents((prev) => (prev.some((e) => e.id === ev.id) ? prev : [...prev, ev]));
        },
      },
    });
  };

  const seekTo = (ev: AnnotationEvent) => playerRef.current?.seek(ev.timestamp);

  /* ---------------------------- queue actions ---------------------------- */

  /** Opens the video in a new tab with a fresh presigned URL. */
  const openVideoInTab = async (video: VideoItem) => {
    // Open synchronously so the popup isn't blocked, then point it at the URL once signed.
    const win = window.open("", "_blank");
    try {
      const cached = qc.getQueryData<StreamUrl>(keys.streamUrl(projectId, video.key));
      if (cached && new Date(cached.expires_at).getTime() - Date.now() < 60_000) {
        qc.removeQueries({ queryKey: keys.streamUrl(projectId, video.key) });
      }
      const { url } = await qc.fetchQuery(streamUrlQuery(projectId, video.key));
      if (win) win.location.href = url;
      else window.open(url, "_blank", "noopener");
    } catch (err) {
      win?.close();
      const { title, hint } = errorMessage(err);
      toast.error(title, { description: hint ?? undefined });
    }
  };

  /**
   * The saved version of `video` this user has seen: the copy on screen for the open video; otherwise
   * this tab's own copy if it is newer than the latest heartbeat (e.g. saved here a moment ago), else the
   * heartbeat. Clearing and deleting send it, and the server refuses if someone saved a newer one since.
   */
  const seenRevision = (video: VideoItem) => {
    const base = baseRef.current;
    const ownCopy = qc.getQueryData<VideoAnnotation | null>(keys.annotation(projectId, video.key));
    const ownIsNewer = ownCopy && (!activity || new Date(ownCopy.updated_at) >= new Date(activity.as_of));
    return video.key === activeKeyRef.current && base?.key === video.key
      ? base.revision
      : ownIsNewer
        ? ownCopy.revision
        : activity
          ? (activity.videos[video.key]?.revision ?? null)
          : undefined;
  };

  const clearAnnotations = async (video: VideoItem) => {
    if (saveMut.isPending) {
      toast.error("A save is in progress. Try again in a moment.");
      throw new Error("save in progress");
    }
    await qc.cancelQueries({ queryKey: keys.annotation(projectId, video.key) });
    const seen = seenRevision(video);
    let movedTo: string | null = null;
    try {
      // Always asked: the queue's status may be a few seconds old.
      movedTo = (await api.clearAnnotation(projectId, video.key, seen)).moved_to;
    } catch (err) {
      const { title, hint } = errorMessage(err);
      toast.error(`Couldn't clear annotations: ${title}`, { description: hint ?? undefined });
      if (err instanceof ApiError && err.code === "CLEAR_CONFLICT") {
        qc.invalidateQueries({ queryKey: keys.annotation(projectId, video.key) });
        qc.invalidateQueries({ queryKey: ["projects", projectId, "activity"] });
      }
      throw err;
    }
    qc.setQueryData(keys.annotation(projectId, video.key), null);
    qc.removeQueries({ queryKey: keys.details(projectId, video.key) });
    qc.setQueryData<VideoList>(keys.videos(projectId), (prev) =>
      prev
        ? {
            ...prev,
            videos: prev.videos.flatMap((v) =>
              v.key !== video.key
                ? [v]
                : v.missing // annotations were all that kept a deleted video in the queue
                  ? []
                  : [{ ...v, status: "not_started" as const, event_count: 0, annotated_at: null }],
            ),
          }
        : prev,
    );
    qc.invalidateQueries({ queryKey: keys.projects, exact: true });
    invalidateReview(qc, projectId);
    if (video.key === activeKeyRef.current) {
      setLabels(withLabelDefaults(schema, undefined));
      setEvents([]);
      setDirty(false);
      baseRef.current = baseOf(video.key, null);
      pendingSave.register(projectId, null);
      setEditingId(null);
      setPreEditDraft(null);
      // New version so an in-flight save can't restore the old events, but nothing left to save:
      // a later Save must not write an empty "in progress" file for the video just cleared.
      bumpVersion();
      savedVersionRef.current = versionRef.current;
    }
    toast.success(`Cleared annotations for ${video.filename}`, {
      description: movedTo ? `Previous version kept at ${movedTo}` : undefined,
    });
  };

  /** "Delete video": out of the queue and export for everyone, annotations cleared, the S3 file kept. */
  const deleteVideo = async (video: VideoItem) => {
    if (saveMut.isPending) {
      toast.error("A save is in progress. Try again in a moment.");
      throw new Error("save in progress");
    }
    await qc.cancelQueries({ queryKey: keys.annotation(projectId, video.key) });
    try {
      await api.removeVideo(projectId, video.key, seenRevision(video));
    } catch (err) {
      const { title, hint } = errorMessage(err);
      toast.error(`Couldn't delete the video: ${title}`, { description: hint ?? undefined });
      if (err instanceof ApiError && err.code === "CLEAR_CONFLICT") {
        qc.invalidateQueries({ queryKey: keys.annotation(projectId, video.key) });
        qc.invalidateQueries({ queryKey: ["projects", projectId, "activity"] });
      }
      throw err;
    }
    // Where to go if it was open: the next video still to do, else its neighbour.
    const index = videos.findIndex((v) => v.key === video.key);
    const rest = videos.filter((v) => v.key !== video.key);
    const next = findNextTodo(videos, video.key) ?? rest[Math.min(index, rest.length - 1)]?.key ?? null;

    qc.setQueryData(keys.annotation(projectId, video.key), null);
    qc.removeQueries({ queryKey: keys.details(projectId, video.key) });
    qc.setQueryData<VideoList>(keys.videos(projectId), (prev) =>
      prev ? { ...prev, videos: prev.videos.filter((v) => v.key !== video.key) } : prev,
    );
    qc.invalidateQueries({ queryKey: keys.projects, exact: true });
    qc.invalidateQueries({ queryKey: keys.project(projectId), exact: true }); // its list of removed videos
    invalidateReview(qc, projectId);
    if (video.key === activeKeyRef.current) {
      // Its unsaved edits go with it: nothing is left to save.
      pendingSave.register(projectId, null);
      bumpVersion();
      savedVersionRef.current = versionRef.current;
      if (next) doSwitch(next);
    }
    toast.success(`Deleted ${video.filename} from the project`, {
      description: "The file is still in S3. Restore it any time under Settings > General.",
      action: {
        label: "Undo",
        onClick: () =>
          restoreMut.mutate(video.key, {
            onSuccess: () => toast.success(`${video.filename} is back in the queue`),
            onError: (err) => {
              const { title, hint } = errorMessage(err);
              toast.error(`Couldn't restore the video: ${title}`, { description: hint ?? undefined });
            },
          }),
      },
    });
  };

  /* ------------------------------- layout -------------------------------- */

  const toggleQueue = () => prefsStore.write({ ...prefs, queueOpen: !prefs.queueOpen });
  const togglePanel = () => prefsStore.write({ ...prefs, panelOpen: !prefs.panelOpen });

  /* ----------------------------- media errors ---------------------------- */

  const onMediaError = useCallback(
    (err: MediaError | null) => {
      const key = activeKeyRef.current;
      if (!key) return;
      const last = lastRefresh.current;
      // Most failures mid-session are an expired presigned URL: fetch a fresh one once a minute.
      if (!last || last.key !== key || Date.now() - last.at > 60_000) {
        lastRefresh.current = { key, at: Date.now() };
        qc.invalidateQueries({ queryKey: keys.streamUrl(projectId, key) });
        return;
      }
      setMediaError(describeMediaError(err));
    },
    [qc, projectId],
  );

  const retryMedia = () => {
    setMediaError(null);
    lastRefresh.current = null;
    if (activeKey) qc.invalidateQueries({ queryKey: keys.streamUrl(projectId, activeKey) });
  };

  /* ------------------------------- hotkeys ------------------------------- */

  useHotkeys(
    (e) => {
      const p = playerRef.current;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") return void saveOnly();
      if (mod && e.key === "Enter") return void saveAndNext();
      if (e.key === "Escape") {
        if (editingId) exitEdit();
        (document.activeElement as HTMLElement | null)?.blur?.();
        return;
      }
      if (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) return goRelative(e.key === "ArrowDown" ? 1 : -1);
      if (mod || e.altKey) return false;

      switch (e.key) {
        case " ":
        case "k":
        case "K":
          return p?.toggle();
        case "ArrowLeft":
          return e.shiftKey ? p?.seekBy(-1) : p?.stepFrames(-1);
        case "ArrowRight":
          return e.shiftKey ? p?.seekBy(1) : p?.stepFrames(1);
        case ",":
          return p?.stepFrames(-1);
        case ".":
          return p?.stepFrames(1);
        case "j":
        case "J":
          return p?.seekBy(-skipSeconds);
        case "l":
        case "L":
          return p?.seekBy(skipSeconds);
        case "[":
          return p?.changeSpeed(-1);
        case "]":
          return p?.changeSpeed(1);
        case "Enter":
        case "m":
        case "M":
          if (!withEvents) return false;
          return editingId ? updateEvent() : capture();
        case "Delete":
        case "Backspace":
          if (!editing) return false;
          return deleteEvent(editing.event);
        case "?":
          return setShowShortcuts(true);
        case "q":
        case "Q":
          return toggleQueue();
        case "t":
        case "T":
          return togglePanel();
      }

      const digit = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
      if (digit) {
        const n = Number(digit[1]);
        if (e.shiftKey) {
          if (n === 0) return setDraft((d) => ({ ...d, event_name: null }));
          const type = schema.event_types[n - 1];
          if (type) return setDraft((d) => ({ ...d, event_name: type }));
          return;
        }
        const target = n > 0 ? hotkeyTargets(schema)[n - 1] : undefined;
        if (target?.field.scope === "video") {
          const { field, option } = target;
          return changeLabels({ ...labels, [field.key]: toggledValue(field, labels[field.key], option) });
        }
        if (target) {
          const { field, option } = target;
          return setDraft((d) => setDraftValue(d, field, toggledValue(field, draftValue(d, field), option)));
        }
        return;
      }
      return false;
    },
    {
      allowInInputs: (e) =>
        e.key === "Escape" || ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "s" || e.key === "Enter")),
    },
  );

  /* -------------------------------- render ------------------------------- */

  const playerOverlay = urlQ.isPending ? (
    <div className="flex flex-col items-center gap-2 text-sm text-white/70">
      <Spinner className="size-6" /> Preparing secure stream…
    </div>
  ) : urlQ.error ? (
    <ErrorState error={urlQ.error} onRetry={() => urlQ.refetch()} className="text-white [&_p]:text-white/70" compact />
  ) : mediaError ? (
    <ErrorState
      error={new Error(mediaError)}
      onRetry={retryMedia}
      className="text-white [&_p]:text-white/70"
      compact
      action={
        urlQ.data && (
          <Button size="sm" variant="outline" asChild>
            <a href={urlQ.data.url} target="_blank" rel="noreferrer">
              <ExternalLink /> Open file
            </a>
          </Button>
        )
      }
    />
  ) : null;

  const status = annQ.data?.status ?? "not_started";
  const forCoach = ready && coachField != null && isFlagged(coachField, labels[coachField.key]);
  const completedCount = videos.filter((v) => v.status === "completed").length;
  const presence = activity?.presence ?? [];
  const othersHere = presence.filter((p) => p.video_key === activeKey);
  const columns = `${prefs.queueOpen ? "20rem" : "3.25rem"} minmax(0,1fr) ${prefs.panelOpen ? "21rem" : "3.25rem"}`;

  return (
    <div
      style={{ "--ws-cols": columns } as React.CSSProperties}
      className="flex h-full flex-col overflow-y-auto lg:grid lg:[grid-template-columns:var(--ws-cols)] lg:overflow-hidden lg:transition-[grid-template-columns] lg:duration-200 lg:ease-out"
    >
      <aside className="flex max-h-80 min-h-0 shrink-0 flex-col border-b lg:max-h-none lg:border-b-0">
        {/* Kept mounted while collapsed so the search / filter survive. Always shown on small screens. */}
        <div className={cn("flex min-h-0 flex-1 flex-col lg:border-r", !prefs.queueOpen && "lg:hidden")}>
          <VideoQueue
            videos={videos}
            prefix={list.prefix}
            activeKey={activeKey}
            activeDirty={dirty}
            truncated={list.truncated}
            refreshing={refreshing}
            onSelect={requestSwitch}
            onRefresh={onRefresh}
            onCollapse={toggleQueue}
            bucket={list.bucket}
            activeEventCount={ready ? events.length : 0}
            onShowDetails={setDetailsVideo}
            onOpenVideo={openVideoInTab}
            onClear={setClearVideo}
            onRemove={setRemoveVideo}
            storageKey={`lemon.queue.${projectId}`}
            presence={presence}
            limited={coachView}
          />
        </div>
        {!prefs.queueOpen && <QueueRail completed={completedCount} total={videos.length} onExpand={toggleQueue} />}
      </aside>

      <section className="flex shrink-0 flex-col lg:min-h-0 lg:overflow-hidden">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium" title={activeVideo?.filename ?? activeKey ?? ""}>
                {activeVideo?.filename ?? activeKey}
              </span>
              {status === "completed" && (
                <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
                  Completed
                </Badge>
              )}
              {forCoach && (
                <>
                  <Badge
                    variant="outline"
                    className="shrink-0 border-violet-500/40 text-violet-700 dark:text-violet-300"
                  >
                    <Flag /> For coach review
                  </Badge>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="xs"
                        variant="outline"
                        className="shrink-0"
                        onClick={() => void finishReviewRef.current()}
                      >
                        <CheckCheck /> Done reviewing
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-64">
                      Sets “{coachField.label}” to {formatValue(clearedValue(coachField)) || "no answer"}, saves your
                      changes and opens the next flagged video. It stays in the queue.
                    </TooltipContent>
                  </Tooltip>
                </>
              )}
              {othersHere.length > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="shrink-0 border-sky-500/40 text-sky-700 dark:text-sky-300">
                      <Users /> {joinNames(othersHere.map((p) => p.name))} {othersHere.length === 1 ? "is" : "are"} also
                      here
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64">
                    Saves are checked against each other: if you both change this video, whoever saves second chooses
                    which version to keep. Nothing is overwritten silently.
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
          {!coachView && (
            <span
              className={cn(
                "hidden max-w-[40%] min-w-0 truncate font-mono text-[11px] text-muted-foreground xl:block",
                // Room for the filename next to the review badge and button.
                forCoach && "xl:hidden 2xl:block",
              )}
              title={`s3://${list.bucket}/${activeKey}`}
            >
              s3://{list.bucket}/{activeKey}
            </span>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={() => goRelative(-1)} aria-label="Previous video">
                <ChevronUp />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Previous video (Alt+↑)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={() => goRelative(1)} aria-label="Next video">
                <ChevronDown />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Next video (Alt+↓)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setShowShortcuts(true)}
                aria-label="Keyboard shortcuts"
              >
                <Keyboard />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Keyboard shortcuts (?)</TooltipContent>
          </Tooltip>
        </div>

        <div className="shrink-0">
          <VideoPlayer
            ref={playerRef}
            mediaKey={activeKey ?? ""}
            src={urlQ.data && urlQ.data.key === activeKey ? urlQ.data.url : null}
            fps={fps}
            skipSeconds={skipSeconds}
            timeStore={timeStore}
            events={ready ? events : []}
            eventTypes={schema.event_types}
            selectedEventId={editingId}
            onMarkerClick={startEdit}
            onMediaError={onMediaError}
            overlay={playerOverlay}
          />
        </div>

        <div className="flex h-9 shrink-0 items-center justify-between border-b px-4 text-xs">
          <span className="font-medium">
            {withEvents ? (
              <>
                Timeline{" "}
                <span className="ml-1 text-muted-foreground tabular-nums">{ready ? events.length : "–"} events</span>
              </>
            ) : (
              "Video labels"
            )}
          </span>
          <EventLegend eventTypes={schema.event_types} />
        </div>
        <div className="min-h-48 flex-1 lg:min-h-0 lg:overflow-y-auto">
          {annQ.error ? (
            <ErrorState error={annQ.error} onRetry={() => annQ.refetch()} compact />
          ) : !ready ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
              <Skeleton className="h-8 w-2/3" />
            </div>
          ) : (
            <>
              <LabelsSummary schema={schema} labels={labels} />
              {withEvents && (
                <EventList
                  events={events}
                  schema={schema}
                  timeStore={timeStore}
                  selectedId={editingId}
                  flashId={flashId}
                  onSeek={seekTo}
                  onEdit={startEdit}
                  onDelete={deleteEvent}
                />
              )}
            </>
          )}
        </div>
      </section>

      <aside className="shrink-0 border-t lg:min-h-0 lg:border-t-0">
        <div className={cn("h-full lg:border-l", !prefs.panelOpen && "lg:hidden")}>
          <TaggingPanel
            schema={schema}
            fps={fps}
            timeStore={timeStore}
            draft={draft}
            onDraftChange={setDraft}
            labels={labels}
            onLabelsChange={changeLabels}
            showRequiredLabelErrors={showRequiredLabels}
            editing={editing}
            prefs={prefs}
            onPrefsChange={(p) => prefsStore.write({ ...prefs, ...p })}
            disabled={!ready}
            onCapture={capture}
            onUpdate={updateEvent}
            onRetime={retime}
            onCancelEdit={exitEdit}
            onDelete={() => editing && deleteEvent(editing.event)}
            dirty={dirty}
            saving={saveMut.isPending}
            status={status}
            savedAt={annQ.data?.updated_at ?? null}
            eventCount={ready ? events.length : 0}
            onSave={saveOnly}
            onSaveNext={saveAndNext}
            onCollapse={togglePanel}
            showRequiredErrors={showRequired}
          />
        </div>
        {!prefs.panelOpen && (
          <TagRail
            onExpand={togglePanel}
            onCapture={editingId ? updateEvent : capture}
            onSave={saveOnly}
            onSaveNext={saveAndNext}
            canCapture={ready && withEvents}
            dirty={dirty}
            saving={saveMut.isPending}
          />
        )}
      </aside>

      <ShortcutsDialog open={showShortcuts} onOpenChange={setShowShortcuts} />

      <VideoDetailsDialog
        projectId={projectId}
        video={detailsVideo}
        onOpenChange={(open) => !open && setDetailsVideo(null)}
        onOpenVideo={openVideoInTab}
      />

      <ClearAnnotationsDialog
        video={clearVideo}
        eventCount={clearVideo?.key === activeKey && ready ? events.length : (clearVideo?.event_count ?? 0)}
        onOpenChange={(open) => !open && setClearVideo(null)}
        onConfirm={clearAnnotations}
      />

      <RemoveVideoDialog
        video={removeVideo}
        eventCount={removeVideo?.key === activeKey && ready ? events.length : (removeVideo?.event_count ?? 0)}
        onOpenChange={(open) => !open && setRemoveVideo(null)}
        onConfirm={deleteVideo}
      />
    </div>
  );
}

function EventLegend({ eventTypes }: { eventTypes: string[] }) {
  if (eventTypes.length === 0) return null;
  return (
    <div className="hidden min-w-0 items-center gap-3 overflow-hidden text-muted-foreground sm:flex">
      {eventTypes.map((t) => (
        <span key={t} className="flex shrink-0 items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ backgroundColor: eventColor(t, eventTypes) }} />
          {t}
        </span>
      ))}
    </div>
  );
}

export function WorkspaceSkeleton() {
  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-[20rem_minmax(0,1fr)_21rem]">
      <div className="hidden space-y-2 border-r p-3 lg:block">
        <Skeleton className="h-20" />
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-9" />
        ))}
      </div>
      <div className="space-y-3 p-3">
        <Skeleton className="aspect-video w-full" />
        <Skeleton className="h-8" />
        <Skeleton className="h-8" />
      </div>
      <div className="hidden space-y-3 border-l p-4 lg:block">
        <Skeleton className="h-9" />
        <Skeleton className="h-32" />
        <Skeleton className="h-11" />
      </div>
    </div>
  );
}
