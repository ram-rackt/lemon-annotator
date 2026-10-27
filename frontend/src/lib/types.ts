export type FieldType = "checkbox" | "select" | "choices" | "text";

export interface SchemaField {
  key: string;
  label: string;
  type: FieldType;
  options: string[];
  default: boolean | string | null;
  /** choices only: several options may be selected (stored as a list). */
  multiple: boolean;
  /** Must be filled in before an event can be captured. */
  required: boolean;
  /** text only. */
  placeholder: string;
  /** "video": one answer per video, saved with it. "event": recorded with every captured timestamp. */
  scope: FieldScope;
}

export type FieldScope = "video" | "event";

/** A whole-video answer: checkbox -> boolean; dropdown / choice / text -> string; multiple -> list. */
export type LabelValue = boolean | string | string[] | null;

/** Dropdown / single choice / text -> string | null; multiple choice -> list of selected options. */
export type AttributeValue = string | string[] | null;

export interface LabelSchema {
  event_types: string[];
  fields: SchemaField[];
}

export interface StoragePublic {
  access_key_id: string;
  has_secret_access_key: boolean;
  has_session_token: boolean;
  region: string;
  bucket: string;
  prefix: string;
  endpoint_url: string;
  is_configured: boolean;
}

export interface StorageUpdate {
  access_key_id?: string;
  /** Omit to keep the saved secret, "" to clear it. */
  secret_access_key?: string;
  session_token?: string;
  region?: string;
  bucket?: string;
  prefix?: string;
  endpoint_url?: string;
}

export interface ProjectSettings {
  fps: number;
  skip_seconds: number;
  url_expiry_seconds: number;
  /** Key of the whole-video field that flags a video for coach review (null: detected by its name). */
  coach_review_field: string | null;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  storage: StoragePublic;
  label_schema: LabelSchema;
  settings: ProjectSettings;
  last_sync: SyncInfo | null;
  /** completed / in_progress / total_events: current bucket and folder. all_annotated: every folder. */
  stats: { completed: number; in_progress: number; total_events: number; all_annotated: number };
}

export interface ProjectUpdate {
  name?: string;
  description?: string;
  storage?: StorageUpdate;
  label_schema?: LabelSchema;
  settings?: ProjectSettings;
}

export type VideoStatus = "not_started" | "in_progress" | "completed";

export interface VideoItem {
  key: string;
  filename: string;
  size: number | null;
  last_modified: string | null;
  status: VideoStatus;
  event_count: number;
  annotated_at: string | null;
  /** Who saved it last (hosted setup with sign-in). */
  updated_by: string | null;
  missing: boolean;
}

/** Result of the latest bucket listing. */
export interface SyncInfo {
  video_count: number;
  synced_at: string;
  /** Videos uploaded since the previous sync; null on the first sync of a bucket/folder. */
  new_count: number | null;
  total_bytes: number | null;
  truncated: boolean;
}

export interface VideoList {
  videos: VideoItem[];
  truncated: boolean;
  bucket: string;
  prefix: string;
  sync: SyncInfo;
}

export interface VideoDetails {
  key: string;
  filename: string;
  folder: string;
  extension: string;
  bucket: string;
  region: string;
  s3_uri: string;
  console_url: string | null;
  size: number | null;
  content_type: string | null;
  last_modified: string | null;
  etag: string | null;
  storage_class: string | null;
  user_metadata: Record<string, string>;
  s3_error: string | null;
  status: VideoStatus;
  event_count: number;
  annotated_at: string | null;
  updated_by: string | null;
  annotation_file: string | null;
  streaming_url: string | null;
  duration_seconds: number | null;
}

export interface ClearResult {
  key: string;
  cleared: boolean;
  moved_to: string | null;
}

export interface StreamUrl {
  key: string;
  url: string;
  expires_at: string;
}

export interface AnnotationEvent {
  id: string;
  timestamp: number;
  time?: string;
  frame: number | null;
  event_name: string | null;
  checkboxes: Record<string, boolean>;
  attributes: Record<string, AttributeValue>;
  note: string;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface VideoAnnotation {
  video_key: string;
  video_filename: string;
  s3_uri: string;
  streaming_url: string | null;
  streaming_url_expires_at: string | null;
  status: "in_progress" | "completed";
  duration_seconds: number | null;
  fps: number | null;
  event_count: number;
  events: AnnotationEvent[];
  labels: Record<string, LabelValue>;
  created_at: string;
  updated_at: string;
  /** Changes on every save. Saves send the revision they started from, so nothing is silently overwritten. */
  revision: string;
  updated_by: string | null;
}

export interface AnnotationSave {
  status: "in_progress" | "completed";
  events: AnnotationEvent[];
  labels: Record<string, LabelValue>;
  streaming_url?: string | null;
  streaming_url_expires_at?: string | null;
  duration_seconds?: number | null;
  /** Revision these edits are based on; null means "nothing was saved for this video". */
  base_revision: string | null;
}

/** Saved state of one video, from the activity heartbeat. */
export interface VideoState {
  status: VideoStatus;
  event_count: number;
  annotated_at: string;
  updated_by: string | null;
  revision: string | null;
}

/** Someone else with the project open, and the video they are on. */
export interface PresenceEntry {
  user_id: string;
  name: string;
  video_key: string | null;
  seen_at: string;
}

export interface ActivityResult {
  /** Server time of this snapshot; saves made after it are not reflected. */
  as_of: string;
  videos: Record<string, VideoState>;
  presence: PresenceEntry[];
}

export interface ReviewVideo {
  key: string;
  filename: string;
  status: VideoStatus;
  event_count: number;
  duration_seconds: number | null;
  annotated_at: string;
  updated_by: string | null;
  labels: Record<string, LabelValue>;
}

/** Videos in the current folder flagged for coach review, most recently saved first. */
export interface ReviewList {
  /** The chosen key (null: detected automatically), even when it no longer names a usable field. */
  field_key: string | null;
  /** The field in use (chosen or detected); null when there is none. */
  field: SchemaField | null;
  videos: ReviewVideo[];
  warnings: string[];
}

/** One project's part of the dashboard's Coach review tab. */
export interface ProjectReview extends ReviewList {
  project_id: string;
  project_name: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  bucket: string;
  region: string;
  prefix: string;
  video_count: number;
  sample_keys: string[];
  truncated: boolean;
}

export interface ExportResult {
  filename: string;
  path: string;
  video_count: number;
  event_count: number;
  warnings: string[];
  data: unknown;
}
