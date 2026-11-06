"use client";

import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, Eye, EyeOff, KeyRound, PlugZap, ShieldAlert, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SyncPanel } from "@/components/settings/sync-panel";
import { Spinner } from "@/components/ui/spinner";
import { useForgetSavedKey, useSavedKeys, useUpdateProject } from "@/hooks/queries";
import { ApiError, api, errorMessage } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import type { ConnectionTestResult, Project, StorageUpdate } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Where new projects' buckets are assumed to be (the backend uses the same default). */
const DEFAULT_REGION = "ap-south-1";

const REGIONS: [code: string, place: string][] = [
  ["ap-south-1", "Mumbai"],
  ["ap-south-2", "Hyderabad"],
  ["ap-southeast-1", "Singapore"],
  ["ap-southeast-2", "Sydney"],
  ["ap-northeast-1", "Tokyo"],
  ["ap-northeast-2", "Seoul"],
  ["ap-east-1", "Hong Kong"],
  ["me-south-1", "Bahrain"],
  ["me-central-1", "UAE"],
  ["eu-west-1", "Ireland"],
  ["eu-west-2", "London"],
  ["eu-west-3", "Paris"],
  ["eu-central-1", "Frankfurt"],
  ["eu-north-1", "Stockholm"],
  ["eu-south-1", "Milan"],
  ["us-east-1", "N. Virginia"],
  ["us-east-2", "Ohio"],
  ["us-west-1", "N. California"],
  ["us-west-2", "Oregon"],
  ["ca-central-1", "Canada"],
  ["sa-east-1", "São Paulo"],
  ["af-south-1", "Cape Town"],
];
const isListedRegion = (region: string) => REGIONS.some(([code]) => code === region);
/** Select value for "a region not in the list" (typed in by hand). */
const OTHER_REGION = "__other";

/** "AKIAIOSFODNN7EXAMPLE" -> "AKIA…MPLE": enough to recognise a key in a list. */
const maskKey = (id: string) => (id.length > 10 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id);

interface FormState {
  bucket: string;
  prefix: string;
  region: string;
  access_key_id: string;
  secret_access_key: string;
  session_token: string;
  endpoint_url: string;
}

function fromProject(p: Project): FormState {
  return {
    bucket: p.storage.bucket,
    prefix: p.storage.prefix,
    // A project not connected yet starts from the default region.
    region: p.storage.is_configured ? p.storage.region : DEFAULT_REGION,
    access_key_id: p.storage.access_key_id,
    secret_access_key: "",
    session_token: "",
    endpoint_url: p.storage.endpoint_url,
  };
}

export function StorageForm({ project }: { project: Project }) {
  const [form, setForm] = useState<FormState>(() => fromProject(project));
  const [baseline, setBaseline] = useState<FormState>(() => fromProject(project));
  const [clearSecret, setClearSecret] = useState(false);
  const [clearToken, setClearToken] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [showKeyId, setShowKeyId] = useState(false);
  const [advanced, setAdvanced] = useState(Boolean(project.storage.endpoint_url || project.storage.has_session_token));
  const [testResult, setTestResult] = useState<{ ok: ConnectionTestResult } | { error: unknown } | null>(null);
  const update = useUpdateProject(project.id);
  // Typing a region that isn't in the list.
  const [otherRegion, setOtherRegion] = useState(() => !isListedRegion(fromProject(project).region));
  const showOtherRegion = otherRegion || !isListedRegion(form.region);
  // The user's own saved keys. `useSaved`: the secret comes from their saved key for form.access_key_id.
  const savedKeys = useSavedKeys().data ?? [];
  const forgetKey = useForgetSavedKey();
  const [useSaved, setUseSaved] = useState(false);

  const hasSecret = project.storage.has_secret_access_key && !clearSecret;
  const hasToken = project.storage.has_session_token && !clearToken;
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline) || clearSecret || clearToken || useSaved;

  const set = (patch: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...patch }));
    setTestResult(null);
  };

  /** Accepts "s3://bucket/some/prefix" pasted into the bucket field. */
  const onBucketChange = (value: string) => {
    const m = value.trim().match(/^s3:\/\/([^/]+)\/?(.*)$/i);
    if (m) set({ bucket: m[1], prefix: m[2] || form.prefix });
    else set({ bucket: value.trim() });
  };

  const payload = (): StorageUpdate => {
    const body: StorageUpdate = {
      bucket: form.bucket,
      prefix: form.prefix,
      region: form.region,
      access_key_id: form.access_key_id,
      endpoint_url: form.endpoint_url,
    };
    if (form.secret_access_key) body.secret_access_key = form.secret_access_key.trim();
    else if (useSaved) body.use_saved_secret = true;
    else if (clearSecret) body.secret_access_key = "";
    if (form.session_token) body.session_token = form.session_token.trim();
    else if (clearToken) body.session_token = "";
    return body;
  };

  const tester = useMutation({
    mutationFn: () => api.testStorage(project.id, payload()),
    onSuccess: (ok) => setTestResult({ ok }),
    onError: (error) => setTestResult({ error }),
  });

  const save = () =>
    update.mutate(
      { storage: payload() },
      {
        onSuccess: (p) => {
          const next = fromProject(p);
          setForm(next);
          setBaseline(next);
          setClearSecret(false);
          setClearToken(false);
          setUseSaved(false);
          toast.success("Storage settings saved");
        },
        onError: (err) => {
          const { title, hint } = errorMessage(err);
          toast.error(title, { description: hint ?? undefined });
        },
      },
    );

  const detectedRegion =
    testResult && "error" in testResult && testResult.error instanceof ApiError
      ? (testResult.error.details.detected_region as string | undefined)
      : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cloud storage</CardTitle>
        <CardDescription>
          Videos are streamed straight from S3 with short-lived presigned URLs. Nothing is downloaded to this machine.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-5">
        <SyncPanel project={project} unsavedChanges={dirty} />
        <SectionLabel className="mt-2">Location</SectionLabel>
        <div className="-mt-2 grid gap-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.8fr)]">
          <Field label="Bucket name" htmlFor="bucket" hint="Paste s3://bucket/folder to fill both fields.">
            <Input
              id="bucket"
              placeholder="my-video-bucket"
              value={form.bucket}
              onChange={(e) => onBucketChange(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          </Field>
          <Field label="Folder prefix" htmlFor="prefix" hint="Leave empty to scan the whole bucket.">
            <Input
              id="prefix"
              placeholder="videos/2024/"
              value={form.prefix}
              onChange={(e) => set({ prefix: e.target.value })}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          </Field>
          <Field label="Region" htmlFor="region" hint={showOtherRegion ? "Type the region code." : undefined}>
            <Select
              value={showOtherRegion ? OTHER_REGION : form.region}
              onValueChange={(v) => {
                if (v === OTHER_REGION) {
                  setOtherRegion(true);
                } else {
                  setOtherRegion(false);
                  set({ region: v });
                }
              }}
            >
              <SelectTrigger id="region" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REGIONS.map(([code, place]) => (
                  <SelectItem key={code} value={code}>
                    <span className="font-mono">{code}</span>
                    <span className="text-muted-foreground">{place}</span>
                  </SelectItem>
                ))}
                <SelectItem value={OTHER_REGION}>Other…</SelectItem>
              </SelectContent>
            </Select>
            {showOtherRegion && (
              <Input
                aria-label="Region code"
                placeholder="eu-west-1"
                value={form.region}
                onChange={(e) => set({ region: e.target.value.trim() })}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
              />
            )}
          </Field>
        </div>

        <SectionLabel>Credentials</SectionLabel>
        {savedKeys.length > 0 && (
          <div className="-mt-2">
            <Field
              label="Saved keys"
              htmlFor="saved-key"
              hint={
                useSaved ? (
                  <>
                    Your saved secret for this key will be used ·{" "}
                    <button
                      type="button"
                      className="underline underline-offset-2"
                      disabled={forgetKey.isPending}
                      onClick={() =>
                        forgetKey.mutate(form.access_key_id, {
                          onSuccess: () => {
                            setUseSaved(false);
                            set({ access_key_id: baseline.access_key_id });
                            toast.success("Saved key forgotten", {
                              description: "Projects already using it keep working.",
                            });
                          },
                          onError: (err) => toast.error(errorMessage(err).title),
                        })
                      }
                    >
                      forget this key
                    </button>
                  </>
                ) : (
                  "Keys you have connected before. Only you can see and use them."
                )
              }
            >
              <Select
                value={useSaved ? form.access_key_id : ""}
                onValueChange={(id) => {
                  set({ access_key_id: id, secret_access_key: "" });
                  setClearSecret(false);
                  setUseSaved(true);
                }}
              >
                <SelectTrigger id="saved-key" className="w-full sm:w-96">
                  <SelectValue placeholder="Fill in a saved key…" />
                </SelectTrigger>
                <SelectContent>
                  {savedKeys.map((k) => (
                    <SelectItem key={k.access_key_id} value={k.access_key_id}>
                      <KeyRound className="text-muted-foreground" />
                      <span className="font-mono">{maskKey(k.access_key_id)}</span>
                      <span className="text-muted-foreground">used {formatRelative(k.last_used_at)}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        )}
        <div className="-mt-2 grid gap-4 sm:grid-cols-2">
          <Field label="Access Key ID" htmlFor="akid" hint="Leave both keys empty to use your local AWS profile.">
            <div className="relative">
              <Input
                id="akid"
                type={showKeyId ? "text" : "password"}
                placeholder="AKIA…"
                value={form.access_key_id}
                onChange={(e) => {
                  setUseSaved(false);
                  set({ access_key_id: e.target.value.trim() });
                }}
                autoComplete="off"
                spellCheck={false}
                className="pr-9 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowKeyId((s) => !s)}
                className="absolute inset-y-0 right-0 grid w-9 place-items-center text-muted-foreground hover:text-foreground"
                aria-label={showKeyId ? "Hide access key ID" : "Show access key ID"}
              >
                {showKeyId ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Field>
          <Field
            label="Secret Access Key"
            htmlFor="secret"
            hint={
              useSaved && !form.secret_access_key ? (
                "From your saved keys."
              ) : hasSecret ? (
                <>
                  Saved. Leave blank to keep it ·{" "}
                  <button type="button" className="underline underline-offset-2" onClick={() => setClearSecret(true)}>
                    clear
                  </button>
                </>
              ) : clearSecret ? (
                "Will be cleared on save."
              ) : undefined
            }
          >
            <div className="relative">
              <Input
                id="secret"
                type={showSecret ? "text" : "password"}
                placeholder={hasSecret || useSaved ? "••••••••••••••••" : "wJalrXUtnFEMI/…"}
                value={form.secret_access_key}
                onChange={(e) => set({ secret_access_key: e.target.value })}
                autoComplete="new-password"
                spellCheck={false}
                className="pr-9 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowSecret((s) => !s)}
                className="absolute inset-y-0 right-0 grid w-9 place-items-center text-muted-foreground hover:text-foreground"
                aria-label={showSecret ? "Hide secret" : "Show secret"}
              >
                {showSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Field>
        </div>

        <button
          type="button"
          className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setAdvanced((a) => !a)}
        >
          <ChevronDown className={cn("size-3.5 transition-transform", advanced && "rotate-180")} />
          Advanced
        </button>
        {advanced && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Session token"
              htmlFor="token"
              hint={
                hasToken ? (
                  <>
                    Saved. Leave blank to keep it ·{" "}
                    <button type="button" className="underline underline-offset-2" onClick={() => setClearToken(true)}>
                      clear
                    </button>
                  </>
                ) : clearToken ? (
                  "Will be cleared on save."
                ) : (
                  "Only for temporary (STS) credentials."
                )
              }
            >
              <Input
                id="token"
                type="password"
                value={form.session_token}
                onChange={(e) => set({ session_token: e.target.value })}
                autoComplete="off"
                className="font-mono"
              />
            </Field>
            <Field
              label="Custom endpoint URL"
              htmlFor="endpoint"
              hint="For S3-compatible stores: MinIO, Cloudflare R2, Wasabi…"
            >
              <Input
                id="endpoint"
                placeholder="https://<account>.r2.cloudflarestorage.com"
                value={form.endpoint_url}
                onChange={(e) => set({ endpoint_url: e.target.value.trim() })}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
              />
            </Field>
          </div>
        )}

        {testResult && "ok" in testResult && (
          <Alert className="border-emerald-500/30 bg-emerald-500/5">
            <CheckCircle2 className="text-emerald-600 dark:text-emerald-400" />
            <AlertTitle>
              Connected — {testResult.ok.video_count} video{testResult.ok.video_count === 1 ? "" : "s"} found
              {testResult.ok.truncated && " (listing truncated)"}
            </AlertTitle>
            <AlertDescription className="min-w-0">
              {testResult.ok.sample_keys.length > 0 ? (
                <ul className="mt-1 min-w-0 space-y-0.5 font-mono text-xs">
                  {testResult.ok.sample_keys.map((k) => (
                    <li key={k} className="truncate" title={k}>
                      {k}
                    </li>
                  ))}
                </ul>
              ) : (
                <span>The bucket is reachable but no video files match this prefix.</span>
              )}
            </AlertDescription>
          </Alert>
        )}
        {testResult && "error" in testResult && (
          <Alert variant="destructive" className="border-destructive/30 bg-destructive/5">
            <XCircle />
            <AlertTitle>{errorMessage(testResult.error).title}</AlertTitle>
            <AlertDescription className="min-w-0">
              <p>{errorMessage(testResult.error).hint}</p>
              {detectedRegion && (
                <Button
                  size="xs"
                  variant="outline"
                  className="mt-2"
                  onClick={() => {
                    setOtherRegion(false); // listed regions show in the dropdown, others in the box
                    set({ region: detectedRegion });
                  }}
                >
                  Use {detectedRegion}
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}

        <div className="flex gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <p>
            Keys are stored unencrypted with this project&apos;s settings on the Lemon server and are never sent back to
            the browser. Saving also remembers them for your account only, so you can pick them in other projects. Use
            an IAM user with read-only access to this bucket.
          </p>
        </div>
      </CardContent>
      <CardFooter className="justify-end gap-2 border-t">
        <Button variant="outline" onClick={() => tester.mutate()} disabled={!form.bucket || tester.isPending}>
          {tester.isPending ? <Spinner /> : <PlugZap />} Test connection
        </Button>
        <Button onClick={save} disabled={!dirty || update.isPending}>
          {update.isPending && <Spinner />} Save storage
        </Button>
      </CardFooter>
    </Card>
  );
}

function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h3 className={cn("text-xs font-medium tracking-wide text-muted-foreground uppercase", className)}>{children}</h3>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-w-0 grid-cols-1 content-start gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
