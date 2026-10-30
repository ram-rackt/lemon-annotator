"use client";

import { keepPreviousData, type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useSignedIn } from "@/hooks/use-auth";
import { api } from "@/lib/api";
import { isFlagged, reviewField } from "@/lib/schema";
import type {
  ActivityResult,
  AnnotationSave,
  Project,
  ProjectReview,
  ProjectUpdate,
  ReviewList,
  VideoAnnotation,
  VideoList,
} from "@/lib/types";

// Every query waits for useSignedIn(): with sign-in on, nothing is requested until a session is confirmed.

export const keys = {
  projects: ["projects"] as const,
  project: (id: string) => ["projects", id] as const,
  videos: (id: string) => ["projects", id, "videos"] as const,
  streamUrl: (id: string, key: string) => ["projects", id, "stream-url", key] as const,
  annotation: (id: string, key: string) => ["projects", id, "annotation", key] as const,
  details: (id: string, key: string) => ["projects", id, "details", key] as const,
  activity: (id: string, key: string | null) => ["projects", id, "activity", key] as const,
  review: (id: string) => ["projects", id, "review"] as const,
  /** Every project's flagged videos (the dashboard's Coach review tab). */
  reviewAll: ["review"] as const,
};

/** A video's flag (or a project's review field) may have changed: refresh both review lists. */
export function invalidateReview(qc: QueryClient, id: string) {
  qc.invalidateQueries({ queryKey: keys.review(id) });
  qc.invalidateQueries({ queryKey: keys.reviewAll });
}

export function useProjects() {
  return useQuery({ queryKey: keys.projects, queryFn: api.listProjects, enabled: useSignedIn() });
}

export function useProject(id: string) {
  return useQuery({ queryKey: keys.project(id), queryFn: () => api.getProject(id), enabled: useSignedIn() });
}

/** Put a removed video back in the queue. */
export function useRestoreVideo(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => api.restoreVideo(id, key),
    onSuccess: (project: Project) => {
      qc.setQueryData(keys.project(id), project);
      qc.invalidateQueries({ queryKey: keys.projects, exact: true });
      qc.invalidateQueries({ queryKey: keys.videos(id) });
    },
  });
}

export function useUpdateProject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ProjectUpdate) => api.updateProject(id, body),
    onSuccess: (project: Project, body) => {
      qc.setQueryData(keys.project(id), project);
      qc.invalidateQueries({ queryKey: keys.projects, exact: true });
      invalidateReview(qc, id);
      if (body.storage || body.settings) qc.invalidateQueries({ queryKey: keys.videos(id) });
      if (body.storage) {
        // Presigned URLs and object details were made for the old bucket / credentials.
        qc.removeQueries({ queryKey: ["projects", id, "stream-url"] });
        qc.removeQueries({ queryKey: ["projects", id, "details"] });
      }
    },
  });
}

/** Every listing is a sync on the server; mirror its result into the project so Settings and the
 * dashboard show the same numbers as the queue. */
function applySync(qc: QueryClient, id: string, list: VideoList) {
  qc.setQueryData<Project>(keys.project(id), (p) => (p ? { ...p, last_sync: list.sync } : p));
  qc.invalidateQueries({ queryKey: keys.projects, exact: true });
}

export function useVideos(id: string, enabled: boolean) {
  const qc = useQueryClient();
  const signedIn = useSignedIn();
  return useQuery({
    queryKey: keys.videos(id),
    queryFn: async () => {
      const list = await api.listVideos(id);
      applySync(qc, id, list);
      return list;
    },
    enabled: enabled && signedIn,
    staleTime: 5 * 60_000,
  });
}

/** "Sync storage": re-read the bucket now and refresh the queue with the result. */
export function useSyncStorage(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.syncStorage(id),
    onSuccess: (list) => {
      qc.setQueryData(keys.videos(id), list);
      applySync(qc, id, list);
    },
  });
}

/**
 * Presigned URLs never refetch on their own: swapping src mid-playback would stutter.
 * They are refreshed when playback fails (expired) or dropped before reuse when close to expiry.
 */
export function streamUrlQuery(id: string, key: string) {
  return {
    queryKey: keys.streamUrl(id, key),
    queryFn: () => api.streamUrl(id, key),
    staleTime: Infinity,
    gcTime: 15 * 60_000,
  };
}

export function useStreamUrl(id: string, key: string | null) {
  const signedIn = useSignedIn();
  return useQuery({ ...streamUrlQuery(id, key ?? ""), enabled: Boolean(key) && signedIn });
}

export function useAnnotation(id: string, key: string | null) {
  const signedIn = useSignedIn();
  return useQuery({
    queryKey: keys.annotation(id, key ?? ""),
    queryFn: () => api.getAnnotation(id, key!),
    enabled: Boolean(key) && signedIn,
    staleTime: Infinity,
  });
}

const ACTIVITY_INTERVAL_MS = 15_000;
/** Longest a save may take between taking its timestamp and being written. */
const SAVE_WINDOW_MS = 10_000;

/** Every project's flagged videos. `live` (the dashboard's Coach review tab) keeps it up to date while open. */
export function useReviewAll({ live = false }: { live?: boolean } = {}) {
  return useQuery({
    queryKey: keys.reviewAll,
    queryFn: api.reviewAll,
    enabled: useSignedIn(),
    staleTime: live ? 0 : 30_000,
    refetchInterval: live ? ACTIVITY_INTERVAL_MS : false,
    refetchOnWindowFocus: live,
  });
}

/**
 * One project's videos marked for coach review. Only requested once the project has a review field.
 * `live` (the Coach review page) also picks up other people's flags while it is open.
 */
export function useReview(id: string, { enabled = true, live = false }: { enabled?: boolean; live?: boolean } = {}) {
  const signedIn = useSignedIn();
  return useQuery({
    queryKey: keys.review(id),
    queryFn: () => api.reviewVideos(id),
    enabled: enabled && signedIn,
    staleTime: live ? 0 : 30_000,
    refetchInterval: live ? ACTIVITY_INTERVAL_MS : false,
    refetchOnWindowFocus: live,
  });
}

/**
 * Bring other people's saves into the queue. Items saved after the snapshot (e.g. by this tab while
 * the request was in flight) are left alone.
 */
function mergeActivity(qc: QueryClient, id: string, activity: ActivityResult) {
  const asOf = new Date(activity.as_of).getTime();
  // A save's time is taken just before it is written, so one finishing as the snapshot is taken can be
  // missing from it although its time is earlier. Recent local updates wait for the next heartbeat.
  const newerThanSnapshot = (iso: string | null) => iso != null && new Date(iso).getTime() > asOf - SAVE_WINDOW_MS;
  qc.setQueryData<VideoList>(keys.videos(id), (prev) => {
    if (!prev) return prev;
    let changed = false;
    const videos = prev.videos.flatMap((v) => {
      if (newerThanSnapshot(v.annotated_at)) return [v];
      const s = activity.videos[v.key];
      if (s) {
        if (
          v.status === s.status &&
          v.event_count === s.event_count &&
          v.annotated_at === s.annotated_at &&
          v.updated_by === s.updated_by
        )
          return [v];
        changed = true;
        return [
          {
            ...v,
            status: s.status,
            event_count: s.event_count,
            annotated_at: s.annotated_at,
            updated_by: s.updated_by,
          },
        ];
      }
      if (v.status === "not_started" && v.event_count === 0) return [v];
      // Cleared by someone else. A video kept in the queue only by its annotations disappears.
      changed = true;
      return v.missing
        ? []
        : [{ ...v, status: "not_started" as const, event_count: 0, annotated_at: null, updated_by: null }];
    });
    return changed ? { ...prev, videos } : prev;
  });
}

/**
 * Heartbeat of the Annotate view: tells the server which video this user is on and returns everyone's
 * saved progress plus who else is where. Cheap (no S3 calls); paused while the tab is in the background.
 */
export function useActivity(id: string, videoKey: string | null) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: keys.activity(id, videoKey),
    queryFn: async () => {
      const activity = await api.activity(id, videoKey);
      mergeActivity(qc, id, activity);
      return activity;
    },
    enabled: useSignedIn(),
    refetchInterval: ACTIVITY_INTERVAL_MS,
    refetchOnWindowFocus: true,
    staleTime: 0,
    retry: false,
    placeholderData: keepPreviousData,
  });
}

/** Mirror a save made outside the Annotate view's own save path into the queue's row for that video. */
function applySavedToQueue(qc: QueryClient, id: string, key: string, saved: VideoAnnotation) {
  qc.setQueryData<VideoList>(keys.videos(id), (prev) =>
    prev
      ? {
          ...prev,
          videos: prev.videos.map((v) =>
            v.key === key
              ? {
                  ...v,
                  status: saved.status,
                  event_count: saved.events.length,
                  annotated_at: saved.updated_at,
                  updated_by: saved.updated_by,
                }
              : v,
          ),
        }
      : prev,
  );
}

/**
 * Can this save change a coach review list? Only when the video is flagged before or after it. Most
 * saves aren't, and re-reading the lists reads every annotation in the project, so autosave skips it.
 */
function affectsReview(
  qc: QueryClient,
  id: string,
  before: VideoAnnotation | null | undefined,
  saved: VideoAnnotation,
) {
  const project = qc.getQueryData<Project>(keys.project(id));
  const field = project && reviewField(project.label_schema, project.settings.coach_review_field);
  if (!project) return true; // unknown: refresh to be safe
  if (!field) return false;
  if (before === undefined) return true; // previous copy not cached
  return isFlagged(field, before?.labels[field.key]) || isFlagged(field, saved.labels[field.key]);
}

/** "Done" on the Coach review page: clears the video's flag on the server, so it leaves the list. */
export function useFinishReview(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => api.finishReview(id, key),
    onSuccess: (saved, key) => {
      const without = <T extends ReviewList>(r: T): T => ({ ...r, videos: r.videos.filter((v) => v.key !== key) });
      qc.setQueryData<ReviewList>(keys.review(id), (prev) => prev && without(prev));
      qc.setQueryData<ProjectReview[]>(keys.reviewAll, (prev) =>
        prev?.map((p) => (p.project_id === id ? without(p) : p)),
      );
      invalidateReview(qc, id);
      // A coach's queue is the flagged videos (no bucket listing, so refreshing it is cheap).
      if (qc.getQueryData<Project>(keys.project(id))?.access === "coach") {
        qc.invalidateQueries({ queryKey: keys.videos(id) });
      }
      // An open Annotate view re-reads it (and takes it over unless it has unsaved edits).
      qc.invalidateQueries({ queryKey: keys.annotation(id, key) });
      qc.removeQueries({ queryKey: keys.details(id, key) });
      if (saved) applySavedToQueue(qc, id, key, saved);
    },
  });
}

export function useSaveAnnotation(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, body }: { key: string; body: AnnotationSave }) => {
      // A read already in flight would land after the save and put the older copy back in the cache.
      await qc.cancelQueries({ queryKey: keys.annotation(id, key) });
      return api.saveAnnotation(id, key, body);
    },
    onSuccess: (saved: VideoAnnotation, { key }) => {
      void qc.cancelQueries({ queryKey: keys.annotation(id, key) });
      const before = qc.getQueryData<VideoAnnotation | null>(keys.annotation(id, key));
      qc.setQueryData(keys.annotation(id, key), saved);
      qc.removeQueries({ queryKey: keys.details(id, key) });
      if (affectsReview(qc, id, before, saved)) invalidateReview(qc, id);
      applySavedToQueue(qc, id, key, saved);
      qc.invalidateQueries({ queryKey: keys.projects, exact: true });
    },
  });
}
