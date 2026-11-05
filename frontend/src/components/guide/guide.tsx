import {
  ArrowRight,
  BookOpen,
  Cloud,
  Download,
  FolderPlus,
  Info,
  Keyboard,
  Lightbulb,
  PlayCircle,
  Tags,
} from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { DashboardNav } from "@/components/dashboard/dashboard-nav";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

const STEPS = [
  { id: "create", title: "Create a project", icon: FolderPlus },
  { id: "storage", title: "Connect cloud storage", icon: Cloud },
  { id: "schema", title: "Set up the label schema", icon: Tags },
  { id: "annotate", title: "Annotate videos", icon: PlayCircle },
  { id: "export", title: "Review and export", icon: Download },
] as const;

/** The Guide tab: the shortest path from an empty project to exported annotations. */
export function Guide() {
  return (
    <div className="flex min-h-svh flex-col">
      <AppHeader>
        <DashboardNav />
      </AppHeader>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        <div className="mb-10 max-w-2xl">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground">
            <BookOpen className="size-3.5" /> Getting started · about 5 minutes
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Guide</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
            Lemon plays videos straight from your S3 bucket so you can tag moments and describe each video, then export
            everything as JSON. Set up a project once, in this order, and the rest is annotating.
          </p>
        </div>

        <div className="grid gap-10 lg:grid-cols-[13rem_minmax(0,1fr)]">
          <nav aria-label="Steps" className="hidden lg:block">
            <ol className="sticky top-8 space-y-1 border-l">
              {STEPS.map((s, i) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="-ml-px flex items-center gap-2.5 border-l border-transparent py-1.5 pl-4 text-sm text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                  >
                    <span className="font-mono text-xs tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                    {s.title}
                  </a>
                </li>
              ))}
              <li>
                <a
                  href="#shortcuts"
                  className="-ml-px flex items-center gap-2.5 border-l border-transparent py-1.5 pl-4 text-sm text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                >
                  <Keyboard className="size-3.5" /> Shortcuts
                </a>
              </li>
            </ol>
          </nav>

          <div className="min-w-0 space-y-6">
            <Step index={0}>
              <p>
                On <strong>Projects</strong>, click <strong>Create New Project</strong>, give it a name and, if you
                like, a short description. A project is one folder of videos plus the labels you record for them, so
                make one per set of footage you annotate the same way (for example, one per shot type).
              </p>
              <Note>Your projects are shared with your team. People outside it don&apos;t see them.</Note>
            </Step>

            <Step index={1}>
              <p>
                Open the project, go to <Path>Settings › Cloud storage</Path>, and fill in where the videos are. If you
                don&apos;t have these details, ask whoever manages your AWS account.
              </p>
              <Fields
                rows={[
                  [
                    "Bucket name",
                    <>
                      The S3 bucket holding the videos. Tip: paste a full address like{" "}
                      <code className="font-mono text-[13px]">s3://bucket/folder/</code> and both this and the folder
                      fill in.
                    </>,
                  ],
                  ["Folder prefix", "The folder inside the bucket. Leave it empty to use the whole bucket."],
                  [
                    "Region",
                    "Where the bucket lives. It starts at ap-south-1 (Mumbai); pick another only if the bucket is elsewhere.",
                  ],
                  [
                    "Access Key ID and Secret Access Key",
                    "A key pair allowed to read that folder. Read access is all Lemon needs; it never changes your files. Once you've saved a pair, pick it from Saved keys in your other projects instead of typing it again (only you see your saved keys).",
                  ],
                ]}
              />
              <p>
                Click <strong>Test connection</strong>. It tells you how many videos it found, or exactly what is wrong
                (and offers to fix a wrong region). When it succeeds, click <strong>Save storage</strong>, then{" "}
                <strong>Sync storage</strong> at the top to load the videos.
              </p>
              <Note>
                Only <code className="font-mono text-[13px]">.mp4</code> and{" "}
                <code className="font-mono text-[13px]">.mov</code> files are listed, including those in sub-folders.
                Lemon reads the bucket only when you sync, so sync again after adding or removing videos. Once a project
                has annotations, its bucket can&apos;t be changed: create a new project instead.
              </Note>
            </Step>

            <Step index={2}>
              <p>
                In <Path>Settings › Label schema</Path>, decide what you record. Not sure where to start? Click{" "}
                <strong>Load example</strong>, then adjust it.
              </p>
              <dl className="grid gap-3 sm:grid-cols-2">
                <Concept term="Event types">
                  What happened at a moment, such as Smash or Drop. Optional: leave it empty if you only mark moments.
                </Concept>
                <Concept term="Attributes">
                  Extra details to fill in. Pick a type: <strong>Checkbox</strong> (yes or no), <strong>Choices</strong>{" "}
                  (a visible list), <strong>Dropdown</strong> (one value) or <strong>Text</strong>.
                </Concept>
                <Concept term="Whole video">Answered once per video, such as camera angle or lighting.</Concept>
                <Concept term="Each timestamp">
                  Answered for every moment you capture, such as forehand or backhand.
                </Concept>
              </dl>
              <p>
                Tick <strong>Required before capture</strong> on anything that must never be left empty, then click{" "}
                <strong>Save schema</strong>. You can change the schema later; existing answers are kept.
              </p>
              <Note icon={Lightbulb}>
                To send videos to a coach, add a whole-video attribute named <strong>Flagged for Review</strong> with
                the options <strong>true</strong> and <strong>false</strong>. Videos set to true appear under{" "}
                <strong>Coach review</strong>. Already have a Label Studio config? Paste it in the <strong>Code</strong>{" "}
                tab.
              </Note>
            </Step>

            <Step index={3}>
              <p>
                Open the project&apos;s <strong>Annotate</strong> tab. The queue of videos is on the left, the player in
                the middle and the tagging panel on the right.
              </p>
              <ol className="grid gap-2.5">
                <Item n={1}>
                  Play the video with <Kbd>Space</Kbd>. Step frame by frame with <Kbd>←</Kbd> and <Kbd>→</Kbd>.
                </Item>
                <Item n={2}>
                  At each moment that matters, press <Kbd>Enter</Kbd> to capture the timestamp, then choose its event
                  type and attributes in the panel.
                </Item>
                <Item n={3}>Fill in the whole-video answers once for the video.</Item>
                <Item n={4}>
                  Press{" "}
                  <KbdGroup>
                    <Kbd>Ctrl</Kbd>
                    <Kbd>Enter</Kbd>
                  </KbdGroup>{" "}
                  for <strong>Save &amp; Next</strong>: the video is marked completed and the next one opens.
                </Item>
              </ol>
              <Note>
                Your work saves automatically a moment after each change. If a teammate saves the same video at the same
                time, Lemon asks which version to keep; nothing is overwritten silently.
              </Note>
            </Step>

            <Step index={4}>
              <p>
                Flagged videos are listed under <strong>Coach review</strong>. A coach opens one, makes any changes and
                presses <strong>Done reviewing</strong>.
              </p>
              <p>
                When you&apos;re ready, click <strong>Export Project JSON</strong> at the top of the project. The file
                lists every video in the folder with its S3 address, its whole-video answers and each captured moment
                with its time, frame and attributes.
              </p>
            </Step>

            <section id="shortcuts" className="scroll-mt-8 rounded-2xl border bg-muted/20 p-6 sm:p-8">
              <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                <Keyboard className="size-5 text-muted-foreground" /> Shortcuts worth knowing
              </h2>
              <dl className="mt-5 grid gap-x-10 gap-y-2.5 text-sm sm:grid-cols-2">
                {SHORTCUTS.map(([keys, label]) => (
                  <div key={label} className="flex items-center justify-between gap-4 border-b border-dashed pb-2.5">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd>
                      <KbdGroup>
                        {keys.map((k) => (
                          <Kbd key={k}>{k}</Kbd>
                        ))}
                      </KbdGroup>
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-5 flex items-center gap-1.5 text-sm text-muted-foreground">
                Press <Kbd>?</Kbd> while annotating for the full list <ArrowRight className="size-3.5" />
              </p>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

const SHORTCUTS: [string[], string][] = [
  [["Space"], "Play / pause"],
  [["←", "→"], "Previous / next frame"],
  [["Enter"], "Capture timestamp"],
  [["1–9"], "Toggle checkbox or option"],
  [["Ctrl", "S"], "Save"],
  [["Ctrl", "Enter"], "Save & Next"],
  [["Alt", "↑ ↓"], "Previous / next video"],
  [["Ctrl", "K"], "Search projects"],
];

function Step({ index, children }: { index: number; children: React.ReactNode }) {
  const { id, title, icon: Icon } = STEPS[index];
  return (
    <section id={id} className="scroll-mt-8 rounded-2xl border bg-card p-6 sm:p-8">
      <header className="mb-5 flex items-center gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-yellow-300 text-yellow-950 shadow-[0_8px_24px_-12px_rgb(250_204_21/0.8)]">
          <Icon className="size-5" />
        </span>
        <div>
          <p className="font-mono text-xs text-muted-foreground tabular-nums">Step {index + 1}</p>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        </div>
      </header>
      <div className="space-y-4 text-[15px] leading-relaxed text-foreground/90">{children}</div>
    </section>
  );
}

/** A place in the app, like "Settings › Cloud storage". */
function Path({ children }: { children: React.ReactNode }) {
  return <span className="rounded-md bg-muted px-1.5 py-0.5 text-[14px] font-medium text-foreground">{children}</span>;
}

function Fields({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="divide-y overflow-hidden rounded-xl border">
      {rows.map(([name, text]) => (
        <div key={name} className="grid gap-1 px-4 py-3 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-4">
          <dt className="text-sm font-medium">{name}</dt>
          <dd className="text-sm text-muted-foreground">{text}</dd>
        </div>
      ))}
    </dl>
  );
}

function Concept({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <dt className="text-sm font-medium">{term}</dt>
      <dd className="mt-1 text-sm text-muted-foreground">{children}</dd>
    </div>
  );
}

function Item({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border text-xs font-medium tabular-nums">
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}

function Note({ children, icon: Icon = Info }: { children: React.ReactNode; icon?: typeof Info }) {
  return (
    <div className="flex gap-3 rounded-xl border border-sky-500/20 bg-sky-500/5 px-4 py-3 text-sm text-muted-foreground">
      <Icon className="mt-0.5 size-4 shrink-0 text-sky-600 dark:text-sky-400" />
      <div>{children}</div>
    </div>
  );
}
