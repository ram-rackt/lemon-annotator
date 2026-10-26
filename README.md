# Lemon

Self-hosted web app for annotating videos stored in AWS S3 (or any S3-compatible store). Videos stream directly
from S3 through short-lived presigned URLs, so nothing large is copied to your machine. Projects, labels and exports
are plain JSON files in `./app_data`.

- One queue of every `.mp4` / `.mov` under a bucket folder, with per-video status and progress
- Frame-accurate player with keyboard controls and event markers on the scrubber
- Whole-video labels and timestamped events, defined per project (visual editor or Label Studio config)
- Autosave, and one-click export of the whole project to JSON

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

Nothing is required: AWS credentials are entered per project in the app. Optional settings:

| File | Variable | Default | Purpose |
| --- | --- | --- | --- |
| `backend/.env` | `LEMON_DATA_DIR` | `./app_data` | Where projects, annotations and exports are stored |
| `backend/.env` | `LEMON_ALLOWED_HOSTS` | `localhost,127.0.0.1,::1` | Host names the API accepts |
| `backend/.env` | `LEMON_MAX_LIST_KEYS` | `50000` | Max S3 objects scanned per listing |
| `backend/.env` | `LEMON_CORS_ORIGINS` | `http://localhost:3000,...` | Only needed when calling the API directly from a browser |
| `frontend/.env.local` | `BACKEND_URL` | `http://127.0.0.1:8000` | Where the web app forwards `/api` requests |

Both servers listen on `127.0.0.1` only, because the app holds your AWS keys.

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
- Keys are stored in plain text in `app_data/projects/<id>/project.json`, are never sent back to the browser, and
  `app_data/` is git-ignored. Use a read-only IAM user.

## Using Lemon

1. **Create a project** on the dashboard and connect its bucket folder.
2. **Define the label schema** in Settings > Label schema. Each field is either:
   - **Whole video**: one answer per clip (e.g. shot type, verdict)
   - **Each timestamp**: recorded with every captured event, along with an event type and an optional note

   Field types: checkbox, choices (single or multiple), dropdown, text. Required fields must be filled before
   Capture (timestamp fields) or Save & Next (whole-video fields).
3. **Annotate**: pick a video from the queue, press `Enter` to capture an event at the playhead, fill in the labels.
   Changes save automatically. **Save & Next** marks the video completed and opens the next unfinished one.
4. **Export**: **Export Project JSON** writes `app_data/projects/<id>/exports/<project>_<timestamp>.json` and
   downloads a copy.

Right-click a video in the queue to view its details, copy its S3 URI, open it in a new tab, or clear its
annotations. Once a project has annotations, its bucket can't be changed; create a new project instead.

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

## Data on disk

```
app_data/
  projects/<project-id>/
    project.json              settings, storage credentials, label schema
    annotations/<video>.json  one file per annotated video (+ _index.json, rebuilt automatically)
    exports/                  one file per export
  .trash/                     deleted projects and cleared annotations (never emptied automatically)
```

Files are written atomically, so an interrupted write never leaves a partial file. Clearing annotations or deleting a
project moves the files to `.trash/`, from where they can be restored.

## Project structure

```
backend/app/       FastAPI: main.py (app, host check), models.py, storage.py (JSON files), s3_service.py, routers/
backend/tests/     API tests against a simulated S3 (moto)
frontend/src/      Next.js 16 + React 19 + Tailwind + shadcn/ui: app/ (pages), components/, hooks/, lib/
scripts/           setup.mjs (first-time setup), dev.mjs (runs both servers)
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
| "The Lemon API did not respond" | Start the backend, or fix `BACKEND_URL` |

## Development

```bash
# Backend tests (no AWS account needed)
cd backend
.venv\Scripts\python -m pip install -r requirements-dev.txt
.venv\Scripts\python -m pytest

# Frontend checks
cd frontend
npx tsc --noEmit
npm run lint
npm run format
```

## License

MIT
