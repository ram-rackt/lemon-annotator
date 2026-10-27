# Lemon

Web app for annotating videos stored in AWS S3 (or any S3-compatible store). Videos stream directly from S3 through
short-lived presigned URLs, so nothing large is copied anywhere.

- One queue of every `.mp4` / `.mov` under a bucket folder, with per-video status and progress
- Frame-accurate player with keyboard controls and event markers on the scrubber
- Whole-video labels and timestamped events, defined per project (visual editor or Label Studio config)
- Autosave, and one-click export of the whole project to JSON

It runs in one of two ways:

| | Local | Hosted (shared) |
| --- | --- | --- |
| Runs on | Your computer | Vercel (web app) + Render (API) + Supabase (database and sign-in) |
| Data | JSON files in `./app_data` | Postgres in Supabase |
| Sign-in | None; only this computer can reach it | Required for every request |
| Several people | No | Yes: live progress, "who is on this video", and no silent overwrites |

## Requirements

- Node.js 20.9+
- Python 3.10+
- An S3 bucket with H.264 `.mp4` or `.mov` videos

## Quick start

```bash
npm run setup     # first time only: Python venv, dependencies, .env files
npm run dev       # starts the API (port 8000) and the web app (port 3000)
```

Open http://localhost:3000. `Ctrl+C` stops both. If a port is taken, the next free one is used automatically.

### Run backend and frontend separately

Use this when editing backend code on Windows (`npm run dev` runs the backend without auto-reload there).

```bash
# Terminal 1: backend (http://127.0.0.1:8000)
cd backend
.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000    # macOS/Linux: .venv/bin/python -m uvicorn ...

# Terminal 2: frontend (http://localhost:3000)
cd frontend
npm run dev
```

If the backend runs on another port, set `BACKEND_URL` in `frontend/.env.local` and restart the frontend.

### Production

```bash
npm run build     # BACKEND_URL is fixed at build time (default http://127.0.0.1:8000)
npm run start
```

## Configuration

Nothing is required for local use: AWS credentials are entered per project in the app. Optional settings:

| Where | Variable | Default | Purpose |
| --- | --- | --- | --- |
| Backend | `LEMON_DATABASE_URL` | empty | Postgres connection string. Set: data goes to the database instead of `./app_data` |
| Backend | `LEMON_SUPABASE_URL` | empty | Supabase project URL. Set: every request needs a signed-in user |
| Backend | `LEMON_SUPABASE_JWT_SECRET` | empty | Only for older Supabase projects that still sign with the legacy JWT secret |
| Backend | `LEMON_ALLOWED_EMAILS` | empty | Optional: only these emails may use the app (comma-separated) |
| Backend | `LEMON_CORS_ORIGINS` | `http://localhost:3000,...` | Sites allowed to call the API from a browser (your Vercel URL when hosted) |
| Backend | `LEMON_DATA_DIR` | `./app_data` | Where data is stored without a database |
| Backend | `LEMON_ALLOWED_HOSTS` | `localhost,127.0.0.1,::1` | Host names accepted while sign-in is off |
| Backend | `LEMON_MAX_LIST_KEYS` | `50000` | Max S3 objects scanned per listing |
| Frontend | `BACKEND_URL` | `http://127.0.0.1:8000` | Local: where `/api` requests are forwarded |
| Frontend | `NEXT_PUBLIC_API_URL` | empty | Hosted: the API's address; the browser calls it directly |
| Frontend | `NEXT_PUBLIC_SUPABASE_URL` | empty | Hosted: Supabase project URL (turns on the sign-in screen) |
| Frontend | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | empty | Hosted: Supabase publishable key (or the legacy anon key, as `NEXT_PUBLIC_SUPABASE_ANON_KEY`) |

Locally, backend settings go in `backend/.env` and frontend settings in `frontend/.env.local`. Both servers listen on
`127.0.0.1` only, because the app holds your AWS keys.

## Deploy (Vercel + Render + Supabase)

1. **Supabase** ([supabase.com](https://supabase.com)): create a project, then:
   - Authentication > Sign In / Providers: turn **off** "Allow new users to sign up".
   - Authentication > Users > Add user: one per person, with "Auto Confirm User" ticked.
   - Note the **Project URL** and **publishable key** (Project Settings > API Keys).
   - Click **Connect**, set Method to **Session pooler** and copy that string (it looks like
     `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`). Don't use the
     "Direct connection" (`db.<ref>.supabase.co`): it is IPv6-only and Render can't reach it.
   - Lemon doesn't use the secret key; keep it out of every file.
2. **Render** ([render.com](https://render.com)): New > Blueprint, pick this repository, leave Blueprint Path empty
   (it reads `render.yaml` at the root). Fill in `LEMON_DATABASE_URL` (Session pooler string), `LEMON_SUPABASE_URL`
   (Project URL) and `LEMON_CORS_ORIGINS` (`https://example.com` until you know the Vercel URL). Once it is live,
   `https://<service>.onrender.com/api/health` should show `"storage":"database","auth":true`. (The bare address
   answering "Not Found" is normal.) The tables are created on first start.
3. **Vercel** ([vercel.com](https://vercel.com)): import the repository with **Root Directory** `frontend` and add
   `NEXT_PUBLIC_API_URL` (the Render URL, no trailing slash), `NEXT_PUBLIC_SUPABASE_URL` (Project URL) and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
4. **Connect them**: on Render, set `LEMON_CORS_ORIGINS` to the Vercel URL (exactly, no trailing slash). In Supabase,
   Authentication > URL Configuration: set **Site URL** to the Vercel URL and add it under **Redirect URLs** (used by
   password-reset emails).

Pushing to `main` redeploys both. Only the main Vercel URL can call the API; Vercel's per-branch preview links are
not in `LEMON_CORS_ORIGINS` (add them there, comma-separated, if you need them).

To copy existing local projects into Supabase, put `LEMON_DATABASE_URL` in `backend/.env` and run
`.venv\Scripts\python -m app.migrate` from `backend/` (the local files are only read; running it twice is safe).

On free plans, Render sleeps after 15 idle minutes (the first request then takes up to a minute) and Supabase pauses
a project after a week without activity (resume it from the Supabase dashboard).

### Signing in

- Accounts are created by the workspace owner in Supabase (sign-up is off). Sign in with email and password; mistakes
  are explained on the form (empty or malformed email, wrong credentials, unconfirmed email, too many attempts).
- **Forgot password?** on the sign-in screen emails a link; opening it signs you in and asks for a new password.
- The account menu (your avatar, top right) has **Change password** and **Sign out**. Signing out saves any edit that
  hasn't been autosaved yet first.
- `LEMON_ALLOWED_EMAILS` on Render optionally limits the app to specific emails, even if more accounts exist.

### Using the shared database from your computer

With `LEMON_DATABASE_URL` and `LEMON_SUPABASE_URL` in `backend/.env`, and `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `frontend/.env.local`, `npm run dev` asks you to sign in and works on the
same data as the hosted app. Empty those values to go back to a private, local-only Lemon (`./app_data`).

### Working together

- Everyone sees the same projects, queue and progress; the queue refreshes every 15 seconds and when you return to the tab.
- The queue shows who is on which video, and the player header says when someone else is on yours.
- Every save says which version it started from. If someone else saved the video in the meantime, nothing is
  overwritten: you choose **Load theirs** or **Keep mine**. If they saved while you had no unsaved changes, their
  version simply appears (but never while you are editing an event).
- Clearing a video is refused if someone saved a newer version than the one you saw; open it first, then clear.

## AWS setup

1. Create an IAM user with read-only access to the folder:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": "s3:ListBucket",
         "Resource": "arn:aws:s3:::YOUR_BUCKET",
         "Condition": { "StringLike": { "s3:prefix": ["videos/*"] } }
       },
       { "Effect": "Allow", "Action": "s3:GetObject", "Resource": "arn:aws:s3:::YOUR_BUCKET/videos/*" }
     ]
   }
   ```

2. In the project's **Settings > Cloud storage**, enter the access key, region, bucket and folder prefix
   (pasting `s3://bucket/folder/` fills both), then **Test connection**. No bucket CORS setup is needed.

- Leave the keys empty to use the standard AWS credential chain (env vars, `AWS_PROFILE`, `~/.aws/credentials`, SSO).
- For MinIO, Cloudflare R2 or Wasabi, set the custom endpoint URL under **Advanced**.
- Keys are stored unencrypted with the project's settings (`app_data/projects/<id>/project.json` locally, the
  `lemon.projects` table when hosted) and are never sent back to the browser. Use a read-only IAM user.

## Using Lemon

1. **Create a project** on the dashboard and connect its bucket folder.
2. **Define the label schema** in Settings > Label schema. Each field is either:
   - **Whole video**: one answer per clip (e.g. shot type, verdict)
   - **Each timestamp**: recorded with every captured event, along with an event type and an optional note

   Field types: checkbox, choices (single or multiple), dropdown, text. Required fields must be filled before
   Capture (timestamp fields) or Save & Next (whole-video fields).
3. **Annotate**: pick a video from the queue, press `Enter` to capture an event at the playhead, fill in the labels.
   Changes save automatically. **Save & Next** marks the video completed and opens the next unfinished one.
4. **Export**: **Export Project JSON** downloads the whole project and keeps a copy: in
   `app_data/projects/<id>/exports/` locally, or in the `lemon.exports` table when hosted.

Right-click a video in the queue to view its details, copy its S3 URI, open it in a new tab, or clear its
annotations. To jump to another project from any page, use the search box in the top bar (`Ctrl` + `K`). Once a project has annotations, its bucket can't be changed; create a new project instead.

### Coach review

Give the label schema a whole-video field that flags a video for review: a choice with `true` / `false` options (or
`yes` / `no`), or a checkbox. A field with "review" in its name, such as **Flagged for Review**, is used automatically;
pick another under **Settings > General > Coach review field**.

Videos set to `true` appear in the **Coach review** tab on the dashboard, grouped by project (and in each project's own
Coach review tab). They stay in the queue too, and are listed most recently saved first with their other whole-video
labels. The coach opens one, makes any changes and presses **Done reviewing**, which sets the
flag to `false`, saves, and opens the next flagged video. **Done** on the list does the same without opening it. The
list refreshes every 15 seconds while it is open.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` / `K` | Play / pause |
| `←` / `→` | Previous / next frame |
| `Shift` + `←` / `→` | Back / forward 1 second |
| `J` / `L` | Back / forward by the skip interval (default 5 s) |
| `[` / `]` | Slower / faster |
| `Enter` / `M` | Capture timestamp, or update the event being edited |
| `1`–`9` | Toggle the first nine checkboxes / choice options |
| `Shift` + `1`–`9` | Set event type (`Shift` + `0` clears it) |
| `Esc` / `Delete` | Cancel editing / delete the event being edited |
| `Ctrl` + `S` / `Ctrl` + `Enter` | Save / Save & Next |
| `Alt` + `↑` / `↓` | Previous / next video |
| `Q` / `T` | Show / hide the queue / label panel |
| `Ctrl` + `K` | Search projects (the search box in the top bar, on any page) |
| `?` | Show all shortcuts |

On macOS, use `Cmd` instead of `Ctrl`.

### Label Studio config

The schema can also be pasted as a [Label Studio](https://labelstud.io/tags/) config in the **Code** editor:

| Tag | Becomes |
| --- | --- |
| `<Header value="..."/>` | Label of the next control |
| `<Choices name choice="single\|multiple">` + `<Choice value/>` | Choices field (`layout="select"` makes a dropdown) |
| `<TextArea name placeholder/>` | Text field |
| `<TimelineLabels>` / `<Labels>` + `<Label value/>` | Event types |
| `<Checkbox name value checked/>` | Checkbox (Lemon extension) |
| `required="true"` / `perRegion="true"` | Required field / recorded per timestamp instead of per video |

`<View>`, `<Video>` and other layout tags are ignored; unsupported controls are skipped with a warning.

## Export format

```json
{
  "format": "lemon/v1",
  "exported_at": "2026-10-24T10:12:09.512345+00:00",
  "project": { "id": "mid-court-e93f91", "name": "mid court", "bucket": "my-bucket", "prefix": "clips/", "fps": 30 },
  "label_schema": { "event_types": ["Smash"], "fields": [], "field_labels": { "shot_type": "Shot Type" } },
  "summary": { "total_videos": 6, "completed": 6, "in_progress": 0, "not_started": 0, "total_events": 1 },
  "videos": [
    {
      "video_filename": "HANNA.mp4",
      "s3_key": "clips/HANNA.mp4",
      "s3_uri": "s3://my-bucket/clips/HANNA.mp4",
      "status": "completed",
      "duration_seconds": 2.26,
      "labels": { "shot_type": "backhand_straight_lift", "error_pattern": ["poor_timing"] },
      "events": [
        {
          "id": "4f0c9e1a2b3c",
          "timestamp": 1.25,
          "time": "00:00:01.250",
          "frame": 37,
          "event_name": "Smash",
          "checkboxes": { "forehand": true },
          "attributes": { "court_side": "Left" },
          "note": ""
        }
      ]
    }
  ]
}
```

Every video in the current bucket folder is included, annotated or not. Each video also carries a `streaming_url`,
which expires by design; use `s3_uri` as the permanent reference.

## Stored data

Nothing is ever erased: clearing a video's annotations or deleting a project keeps the old data, restorable.

**Local** (`./app_data`): files are written atomically, so an interrupted write never leaves a partial file. Cleared
and deleted data is moved to `.trash/` (never emptied automatically).

```
app_data/
  projects/<project-id>/
    project.json              settings, storage credentials, label schema
    annotations/<video>.json  one file per annotated video (+ _index.json, rebuilt automatically)
    exports/                  one file per export
  .trash/                     deleted projects and cleared annotations
```

**Hosted** (Supabase): tables `lemon.projects`, `lemon.annotations` and `lemon.exports`. Cleared and deleted rows get
a `deleted_at` time instead of being removed (clear `deleted_at` to restore one). The `lemon` schema is not exposed
through Supabase's Data API and has row-level security on, so only the Lemon API can read it. Supabase backs up the
database daily on paid plans; on the free plan, export regularly.

## Project structure

```
backend/app/       FastAPI: main.py (app, host check), auth.py (sign-in), models.py, storage.py (JSON files),
                   db_store.py (Postgres), presence.py, s3_service.py, migrate.py, routers/
backend/tests/     API tests against a simulated S3 (moto), for both storage types
frontend/src/      Next.js 16 + React 19 + Tailwind + shadcn/ui: app/ (pages), components/ (annotate, settings,
                   dashboard, auth: sign-in screen and account menu), hooks/, lib/ (API client, Supabase client)
scripts/           setup.mjs (first-time setup), dev.mjs (runs both servers)
render.yaml        Render Blueprint for the API
```

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Access key not recognized / secret incorrect | Re-enter the keys |
| "Bucket is in region X" | Use the suggested region (Test connection offers a button) |
| "Access denied" | Attach the IAM policy above |
| "Your computer clock is out of sync" | Turn on automatic time sync (AWS signatures depend on it) |
| Video won't play but the connection works | It's likely HEVC/ProRes. Re-encode: `ffmpeg -i in.mov -c:v libx264 -pix_fmt yuv420p -movflags +faststart out.mp4` |
| Video missing from the queue | Only `.mp4`/`.mov` under the prefix are listed. Use the queue's refresh button |
| "The Lemon API did not respond" | Locally: start the backend, or fix `BACKEND_URL`. Hosted: Render is waking up; wait a minute |
| "Could not reach the database" | Check `LEMON_DATABASE_URL` (Session pooler string) and that the Supabase project isn't paused |
| `failed to resolve host 'db.<ref>.supabase.co'` | That's the IPv6-only direct connection; use the Session pooler string |
| Hosted app can't reach the API (network error) | `LEMON_CORS_ORIGINS` on Render must be exactly your Vercel URL (no trailing slash) |
| "Incorrect email or password" | Check both; the owner can reset it in Supabase > Authentication > Users |
| "This email isn't confirmed yet" | In Supabase > Authentication > Users, confirm the user (or re-create it with Auto Confirm) |
| Password-reset link opens the wrong site | Set Site URL and Redirect URLs in Supabase > Authentication > URL Configuration |
| "This account is not allowed" | Add the email to `LEMON_ALLOWED_EMAILS`, or remove that setting |

## Development

```bash
# Backend tests (no AWS account or database needed: S3 is simulated, the database tests use SQLite)
cd backend
.venv\Scripts\python -m pip install -r requirements-dev.txt
.venv\Scripts\python -m pytest
# Optional: also run the database tests against a real, throwaway Postgres (its `lemon` schema is wiped!)
# LEMON_TEST_DATABASE_URL=postgresql://postgres@localhost:5432/postgres

# Frontend checks
cd frontend
npx tsc --noEmit
npm run lint
npm run format
```

## License

MIT
