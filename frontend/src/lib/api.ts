import { toast } from "sonner";

import { pendingSave } from "./pending-save";
import { accessToken, supabase } from "./supabase";
import type {
  ActivityResult,
  AnnotationSave,
  ClearResult,
  ConnectionTestResult,
  ExportResult,
  Project,
  ProjectReview,
  ProjectUpdate,
  ReviewList,
  StorageUpdate,
  StreamUrl,
  VideoAnnotation,
  VideoDetails,
  VideoList,
} from "./types";

/**
 * Hosted: the API's own address (e.g. https://lemon-api.onrender.com); the browser calls it directly,
 * which avoids proxy time limits on long bucket listings. Locally: empty, so requests go to this site's
 * /api, which Next.js forwards to the backend.
 */
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");

const UNREACHABLE_HINT = API_URL
  ? "The server may be waking up (free hosting sleeps when idle; this takes up to a minute). Try again shortly."
  : "Make sure the backend is running (npm run dev from the repo root).";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string = "UNKNOWN",
    public hint: string | null = null,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** The sign-in is no longer accepted: say why, then show the sign-in screen. */
function endSession(message: string) {
  const sb = supabase();
  if (!sb) return;
  toast.error(message, {
    id: "session-ended",
    description: pendingSave.hasPending()
      ? "Your most recent changes could not be saved. Sign in again and redo them."
      : undefined,
    duration: 10_000,
  });
  void sb.auth.signOut();
}

/** A 401 usually means the access token just expired: get a fresh one (true if that worked). */
async function refreshSignIn(): Promise<boolean> {
  const sb = supabase();
  if (!sb) return false;
  try {
    const { data, error } = await sb.auth.refreshSession();
    return !error && Boolean(data.session);
  } catch {
    return false;
  }
}

async function request<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
  const token = await accessToken();
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError("Cannot reach the Lemon API.", 0, "API_UNREACHABLE", UNREACHABLE_HINT);
  }

  if (res.ok) {
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error (e.g. proxy failure) */
  }
  const err = (
    body as { error?: { code?: string; message?: string; hint?: string; details?: Record<string, unknown> } }
  )?.error;
  if (err?.message) {
    // Retry once with a refreshed token before giving up on the session (unsaved edits are then kept).
    if (res.status === 401 && !retried && (await refreshSignIn())) return request<T>(path, init, true);
    if (res.status === 401 || err.code === "AUTH_FORBIDDEN") endSession(err.message);
    throw new ApiError(err.message, res.status, err.code, err.hint ?? null, err.details ?? {});
  }
  if (res.status === 500 || res.status === 502 || res.status === 503 || res.status === 504) {
    // The local Next.js proxy returns a bare 500 when FastAPI is down; hosts return 502/503 while waking.
    throw new ApiError(
      "The Lemon API did not respond.",
      res.status,
      "API_UNREACHABLE",
      API_URL ? UNREACHABLE_HINT : "Start the backend: npm run dev (repo root) or uvicorn app.main:app --port 8000.",
    );
  }
  throw new ApiError(`Request failed (${res.status})`, res.status);
}

const q = (key: string) => `key=${encodeURIComponent(key)}`;
const json = (body: unknown) => JSON.stringify(body);

export const api = {
  listProjects: () => request<Project[]>("/api/projects"),
  getProject: (id: string) => request<Project>(`/api/projects/${id}`),
  createProject: (body: { name: string; description?: string }) =>
    request<Project>("/api/projects", { method: "POST", body: json(body) }),
  updateProject: (id: string, body: ProjectUpdate) =>
    request<Project>(`/api/projects/${id}`, { method: "PATCH", body: json(body) }),
  deleteProject: (id: string) =>
    request<{ ok: boolean; moved_to: string }>(`/api/projects/${id}`, { method: "DELETE" }),
  testStorage: (id: string, storage?: StorageUpdate) =>
    request<ConnectionTestResult>(`/api/projects/${id}/storage/test`, {
      method: "POST",
      body: storage ? json(storage) : undefined,
    }),

  listVideos: (id: string) => request<VideoList>(`/api/projects/${id}/videos`),
  syncStorage: (id: string) => request<VideoList>(`/api/projects/${id}/sync`, { method: "POST" }),
  streamUrl: (id: string, key: string) => request<StreamUrl>(`/api/projects/${id}/videos/stream-url?${q(key)}`),
  videoDetails: (id: string, key: string) => request<VideoDetails>(`/api/projects/${id}/videos/details?${q(key)}`),
  /** `revision`: the saved version the user saw (null: nothing saved; undefined: unknown, no check). */
  /** Take a video out of the project (queue, export) and clear its annotations; the S3 file stays. */
  removeVideo: (id: string, key: string, revision?: string | null) =>
    request<ClearResult>(
      `/api/projects/${id}/videos?${q(key)}${revision === undefined ? "" : `&revision=${encodeURIComponent(revision ?? "")}`}`,
      { method: "DELETE" },
    ),
  restoreVideo: (id: string, key: string) =>
    request<Project>(`/api/projects/${id}/videos/restore?${q(key)}`, { method: "POST" }),
  clearAnnotation: (id: string, key: string, revision?: string | null) =>
    request<ClearResult>(
      `/api/projects/${id}/annotations?${q(key)}${revision === undefined ? "" : `&revision=${encodeURIComponent(revision ?? "")}`}`,
      { method: "DELETE" },
    ),
  getAnnotation: (id: string, key: string) =>
    request<VideoAnnotation | null>(`/api/projects/${id}/annotations?${q(key)}`),
  saveAnnotation: (id: string, key: string, body: AnnotationSave) =>
    request<VideoAnnotation>(`/api/projects/${id}/annotations?${q(key)}`, {
      method: "PUT",
      body: json(body),
    }),
  reviewVideos: (id: string) => request<ReviewList>(`/api/projects/${id}/review`),
  reviewAll: () => request<ProjectReview[]>("/api/review"),
  finishReview: (id: string, key: string) =>
    request<VideoAnnotation | null>(`/api/projects/${id}/review/done?${q(key)}`, { method: "POST" }),
  exportProject: (id: string) => request<ExportResult>(`/api/projects/${id}/export`, { method: "POST" }),
  activity: (id: string, videoKey: string | null) =>
    request<ActivityResult>(`/api/projects/${id}/activity`, { method: "POST", body: json({ video_key: videoKey }) }),
};

/** A save refused because someone else saved (or cleared) the video since these edits started. */
export const isConflict = (error: unknown): error is ApiError =>
  error instanceof ApiError && error.code === "ANNOTATION_CONFLICT";

export function errorMessage(error: unknown): { title: string; hint: string | null } {
  if (error instanceof ApiError) return { title: error.message, hint: error.hint };
  if (error instanceof Error) return { title: error.message, hint: null };
  return { title: "Something went wrong", hint: null };
}
