# Job Queue + S3 Storage — Design

**Date:** 2026-04-06
**Status:** Approved, ready for implementation plan
**Scope:** Replace the single-job inline workflow with a persistent multi-job queue backed by S3.

---

## Why this exists

Pano360Align is a batch tool. A user with 20 videos to correct should be able to:

1. Drop video 1, align it, hit Produce, **immediately drop video 2** without waiting.
2. Submit as many jobs as they want; they queue serially on the server.
3. Close the browser, go to bed, come back tomorrow morning, and find 20 corrected MP4s ready to download.
4. If one job fails (FFmpeg crash, server restart, anything), retry it without losing the alignment values they spent time tweaking.

The current implementation does **none** of that. It's a single-shot in-memory pipeline tied to the browser tab.

---

## Architecture

```
Browser                      App Server                     S3
───────                      ──────────                     ──
  │                              │                          │
  │ 1. POST /api/upload-init     │                          │
  │   (filename, alignment)      │                          │
  │ ──────────────────────────►  │                          │
  │                              │ 1a. createJob()          │
  │                              │ 1b. write job.json       │
  │                              │ ───────────────────────► │
  │                              │ 1c. presign PUT for      │
  │ ◄────────────────────────── │     jobs/{id}/input.mp4  │
  │   { jobId, putUrl, key }     │                          │
  │                              │                          │
  │ 2. PUT putUrl                │                          │
  │   (raw file body, w/ XHR     │                          │
  │    progress)                 │                          │
  │ ─────────────────────────────────────────────────────► │
  │ ◄───────────────────────────────────────────────────── │
  │   200 OK                                                │
  │                              │                          │
  │ 3. POST /api/upload-complete │                          │
  │   { jobId }                  │                          │
  │ ──────────────────────────►  │                          │
  │                              │ 3a. mark job "queued"    │
  │                              │ 3b. write job.json       │
  │                              │ ───────────────────────► │
  │ ◄────────────────────────── │                          │
  │   { ok }                     │                          │
  │                              │                          │
  │                              │ ┌──── Worker (serial) ───┐
  │                              │ │ pop next "queued" job │
  │                              │ │ download input ◄──────┼──
  │                              │ │ run ffmpeg            │
  │                              │ │ upload output ────────┼─►
  │                              │ │ delete local files    │
  │                              │ │ mark "complete"       │
  │                              │ │ write job.json ───────┼─►
  │                              │ └───────────────────────┘
  │                              │                          │
  │ 4. POST /api/jobs/list       │                          │
  │   { ids: [...] }             │                          │
  │ ──────────────────────────►  │                          │
  │ ◄────────────────────────── │                          │
  │   [snapshots...]             │                          │
  │   (polled every 3-5s)        │                          │
  │                              │                          │
  │ 5. GET /api/download/{id}    │                          │
  │ ──────────────────────────►  │                          │
  │ ◄────────────────────────── │                          │
  │   302 → presigned S3 URL     │                          │
  │ ─────────────────────────────────────────────────────► │
  │ ◄───────────────────────────────────────────────────── │
  │   {video stream}                                        │
```

The app server's bandwidth is **only** used for tiny JSON API calls and the transient input/output during FFmpeg. The file itself never traverses the app server.

---

## S3 layout

```
pano360align-files/
└── jobs/
    └── {jobId}/
        ├── input.{ext}     ← original upload
        ├── output.mp4      ← corrected output (only present after success)
        └── job.json        ← persisted job state, source of truth across restarts
```

`job.json`:
```json
{
  "id": "uuid",
  "filename": "Q360_20260313_144545.mp4",
  "ext": "mp4",
  "status": "queued",
  "progress": 0,
  "alignment": { "yaw": 1.2, "pitch": -0.3, "roll": -2.8 },
  "trimStart": 0,
  "size": 2461302841,
  "createdAt": 1775478000000,
  "completedAt": null,
  "error": null
}
```

---

## Job lifecycle

```
pending-upload  → upload-init created the job, waiting for the browser PUT to S3
                  (timeout: stuck for 30 min → marked failed)

queued          → upload-complete confirmed input is in S3, waiting in queue

downloading     → worker is pulling input from S3 to local disk

processing      → ffmpeg is running, progress 0-99

uploading       → ffmpeg done, output being pushed to S3

complete        → output.mp4 is in S3, ready to download

failed          → something blew up. error field populated. input still in S3 → retryable.

expired         → 30 days after createdAt the lifecycle policy deletes the S3 prefix.
                  job.json gone too. Boot scan stops returning the job.
```

State transitions are written to `job.json` on every change. The `job.json` in S3 is the source of truth — the in-memory map is just a cache rebuilt from S3 on boot.

---

## Server-side queue

A single in-process FIFO with concurrency = 1.

```ts
// jobs.ts (sketch)
const queue: string[] = [];      // jobIds awaiting processing
let currentJobId: string | null = null;
let workerRunning = false;

function enqueue(id: string) {
  if (!queue.includes(id) && currentJobId !== id) queue.push(id);
  startWorker();
}

async function startWorker() {
  if (workerRunning) return;
  workerRunning = true;
  try {
    while (queue.length > 0) {
      const id = queue.shift()!;
      currentJobId = id;
      await processOne(id);
      currentJobId = null;
    }
  } finally {
    workerRunning = false;
  }
}
```

`processOne(id)` does the full download → ffmpeg → upload sequence with state updates persisted to S3 between phases.

**Why concurrency = 1:** an FFmpeg `libx264 -preset slow` job uses 1-2 cores effectively *and* a lot of RAM for big videos. Two parallel jobs on a typical Coolify server would OOM or thrash. The env var `MAX_CONCURRENT_JOBS` is reserved for future use; v1 ignores it.

---

## Boot recovery

On server start:

1. List `s3://pano360align-files/jobs/*/job.json`
2. Download each, parse, populate the in-memory map
3. For any job whose status is `processing`, `downloading`, or `uploading` → reset to `queued` and re-enqueue (the previous worker died with the container)
4. For any job whose status is `pending-upload` and is older than 30 minutes → mark `failed` with error "Upload never completed"
5. Start the worker

This means a Coolify redeploy is invisible to the user: jobs that were running just take a bit longer.

---

## Retry

**Manual retry** — `POST /api/job/{id}/retry` on a failed job. Server checks the input still exists in S3 (`HeadObject`), if so resets the job to `queued` and enqueues. If the input is gone (lifecycle expired or manually deleted), returns 410 Gone.

**Automatic retry** is just a side-effect of boot recovery — see above.

---

## Client-side state

The browser is **stateless** about jobs except for one thing: a localStorage list of jobIds the user has personally submitted from this browser.

```ts
// clientJobs.ts
interface ClientJobRef {
  id: string;
  filename: string;
  submittedAt: number;
}
// localStorage key: "pano360.jobs"
```

On page load, the client reads this list and immediately calls `POST /api/jobs/list { ids: [...] }` to fetch current statuses.

It then polls the same endpoint every **3 seconds** as long as any job is in a non-terminal state, or every **15 seconds** if all are terminal.

When a job is dismissed from the list, it's removed from localStorage AND `DELETE /api/job/{id}` is called to clean up S3.

---

## API surface

| Endpoint | Method | Body | Returns |
|---|---|---|---|
| `/api/upload-init` | POST | `{ filename, alignment, trimStart }` | `{ jobId, putUrl, key }` |
| `/api/upload-complete` | POST | `{ jobId }` | `{ ok, snapshot }` |
| `/api/jobs/list` | POST | `{ ids: string[] }` | `JobSnapshot[]` |
| `/api/download/{id}` | GET | — | 302 → presigned S3 URL |
| `/api/job/{id}` | DELETE | — | `{ ok }` (deletes S3 prefix) |
| `/api/job/{id}/retry` | POST | — | `{ ok, snapshot }` |

**Removed:** `/api/upload` (replaced by upload-init/upload-complete), `/api/progress/{id}` (SSE replaced by polling — simpler, survives reconnects, no proxy weirdness).

---

## UI changes

### Job list panel (top of page, above upload zone)

```
┌───────────────────────────────────────────────────────────────────┐
│  Jobs (3)                                              Clear done │
├───────────────────────────────────────────────────────────────────┤
│  ✓  Q360_20260313_144545.mp4  •  Complete                [↓ Get] │
│  ⟳  Q360_20260315_103022.mp4  •  Processing 47%       [✕ Cancel] │
│  ⏸  Q360_20260316_181109.mp4  •  Queued (#2)          [✕ Cancel] │
│  ✗  Q360_20260317_092044.mp4  •  Failed: ffmpeg exit 1                  │
│                                                  [↻ Retry] [✕]   │
└───────────────────────────────────────────────────────────────────┘
```

- Always visible at the top of the page
- Scrolls if there are many jobs
- Updates via 3s polling
- Per-row actions depend on status (download/cancel/retry/dismiss)
- "Clear done" wipes only `complete` jobs from the local list (S3 lifecycle handles their actual deletion)

### Workflow change

After hitting Produce on the alignment view:

1. Upload starts, progress shown inline as before
2. Upload finishes → job is added to localStorage, list panel shows "Queued"
3. **Alignment view collapses, upload zone returns to ready state, alignment values reset to zero**
4. User immediately drops the next file
5. The job list panel handles all subsequent status reporting for the previous job

The user never has to wait between submissions.

### Dismissing in-progress jobs

If a user clicks ✕ on a `processing` job, the server kills the FFmpeg child, deletes the S3 prefix, and removes the job from the map. Same behaviour as the existing cancel.

---

## File layout

```
src/
├── lib/
│   ├── s3.ts                 ← NEW: S3 client wrapper, presigning, object ops
│   ├── jobs.ts               ← REWRITE: queue worker, S3 persistence, boot recovery
│   └── clientJobs.ts         ← NEW: localStorage helpers
├── app/api/
│   ├── upload/route.ts       ← DELETE
│   ├── upload-init/route.ts  ← NEW
│   ├── upload-complete/route.ts ← NEW
│   ├── jobs/list/route.ts    ← NEW
│   ├── progress/[jobId]/route.ts ← DELETE
│   ├── download/[jobId]/route.ts ← REWRITE: 302 → presigned URL
│   ├── job/[jobId]/route.ts  ← REWRITE: cancel + S3 cleanup
│   ├── job/[jobId]/retry/route.ts ← NEW
│   └── process/route.ts      ← DELETE (alignment values come in via upload-init now)
├── components/
│   ├── jobs/
│   │   └── JobList.tsx       ← NEW
│   └── video/
│       └── VideoSection.tsx  ← REWRITE Produce flow
└── app/page.tsx              ← MODIFY: render JobList, reset-after-produce flow
```

---

## Environment variables

Set in Coolify → Application → Environment Variables (already done):

```
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION=eu-north-1
AWS_S3_BUCKET=pano360align-files
```

Optional, with defaults baked in:

```
TEMP_DIR=/tmp/360aligner             # transient working space for ffmpeg
FFMPEG_PATH=ffmpeg
PRESIGN_PUT_EXPIRY_SECONDS=3600      # 1 hour to upload after init
PRESIGN_GET_EXPIRY_SECONDS=3600      # 1 hour to download after click
```

---

## Out of scope (explicit)

- **Multi-user accounts.** Anyone with a jobId can download. Same as today.
- **Multi-server scaling.** The queue is in-process. If you ever run >1 container instance, two workers would both pull the same job. Solving this needs a real lock / message bus.
- **Surviving the underlying VPS dying.** S3 protects against the container, redeploys, and the local disk dying. It does not protect against your Hetzner box being deleted. Snapshots handle that.
- **Email/push notifications when a job completes.** The user has to come back to the page.
- **Configurable parallelism.** Hardcoded serial. The env var hook is reserved.
- **Resuming an in-progress S3 upload.** If a direct browser PUT fails partway, the user has to start that file's upload over. (S3 multipart could fix this — out of scope.)
- **Job ownership / sharing.** localStorage is per-browser. Switching browsers loses the list (but the jobs themselves remain in S3 and can be accessed if you remember the jobId).
