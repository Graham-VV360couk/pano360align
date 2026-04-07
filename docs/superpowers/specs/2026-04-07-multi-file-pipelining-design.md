# Multi-File Pipelining — Design

**Date:** 2026-04-07
**Status:** Approved in conversation, ready for implementation plan
**Scope:** Make the upload phase non-blocking so the user can submit a batch of files in rapid succession without waiting on bytes.

---

## Why this exists

The current single-file flow is:

```
drop → align → Produce → wait for upload → page resets → drop next
                          ─── BLOCKING ───
```

For someone with 10 cockpit videos to align, this means:

- 10 × upload time (each upload blocks the user)
- During each upload the user is staring at a progress bar, doing nothing
- Even on a fast home link, that's tens of minutes of literal sitting around

The user's actual desired workflow is:

> *"Drop 20 files, do 20 alignments back-to-back, walk away, come back to 20 corrected files."*

The blocker is **the upload step being synchronous**. The fix is to push uploads into a background manager that runs while the user continues with the next alignment.

## The shape of the new flow

```
drop → align → Produce → page resets immediately → drop next
                ↓
                (file enters background upload queue)
                ↓
                upload finishes → upload-complete → server queue picks it up
                ↓
                (server worker chews through jobs serially as before)
```

The user's interactive time is now **only alignment**. Bytes flow in the background.

---

## Key design decisions (from conversation)

1. **Upload starts on Produce, not on drop.** This is the user's explicit refinement of an earlier idea I had. The reason is that aligning a frame is the user's quality gate — they might decide the file is wrong and discard it. Uploading eagerly would waste bandwidth on rejects. Uploading on Produce means the user has already committed to this file.
2. **Concurrency cap on background uploads:** N parallel, configurable, default 1. Most home connections don't usefully parallelise multi-GB uploads beyond 2-3 streams; starting with 1 is the safe default and we can bump it via env var or a UI knob later.
3. **Server queue is unchanged.** Serial worker, FFmpeg one job at a time, same boot recovery, same retry, same persistence. The only thing changing is the *client side* of how files arrive at the queue.
4. **State machine for the JobList row** gains a new visible status:
   - `uploading X%` — background browser → S3 PUT in flight (NEW visible state)
   - `queued (#N)` — input is in S3, waiting for the worker
   - `downloading` — worker pulling input to local disk
   - `processing X%` — FFmpeg running
   - `uploading` (output) — worker pushing output to S3 *(this is the existing "uploading" — we'll rename one to avoid confusion)*
   - `complete` — green ↓ Get button
   - `failed` — red ↻ Retry button
5. **Survives:** all the same things that already survive — page reload (re-attaches via localStorage + S3 polling), browser restart, server reboot, the works. The ONE thing it doesn't survive is a page reload during the `uploading X%` (browser → S3) phase, because the XHR is in-memory only. That's a known limitation; making mid-upload survive a reload requires Service Worker territory and is explicitly out of scope.
6. **No "tray" UI.** I considered an explicit "ready to align" tray to hold files between drop and submission. The user's flow doesn't need that — drop → align → submit is linear, the JobList shows what's been submitted, the upload zone shows what's currently being aligned. No third UI element required.

---

## Architecture

### Client side

A new **`BackgroundUploadManager`** singleton, lives in `src/lib/uploadManager.ts`:

```ts
interface UploadJob {
  id: string;        // matches the server jobId
  putUrl: string;    // presigned S3 URL
  file: File;        // the actual blob to upload
  filename: string;
  size: number;
}

class BackgroundUploadManager {
  private queue: UploadJob[] = [];
  private active: Map<string, XMLHttpRequest> = new Map();
  private maxConcurrent = 1;

  enqueue(job: UploadJob): void;
  cancel(id: string): void;        // aborts XHR if active, removes from queue
  getProgress(id: string): number; // 0-100 for active jobs, 0 if queued, 100 if done
  isActive(id: string): boolean;
  isQueued(id: string): boolean;

  // Subscription for JobList to know when progress changes
  subscribe(listener: () => void): () => void;
}

export const backgroundUploads = new BackgroundUploadManager();
```

The manager:
- Holds a FIFO queue of UploadJobs
- Runs `maxConcurrent` workers, each picking the next job and PUTing it to S3 with XHR for progress events
- Stores progress per job in an in-memory map
- Notifies subscribers (i.e. the JobList) on every progress event so the UI can re-render
- On successful PUT, calls `/api/upload-complete` with the jobId, which flips the server-side job status from `pending-upload` → `queued`
- On failed PUT, leaves the job in `pending-upload` state on the server (the 30-min boot-recovery timeout will eventually mark it failed)

### How `produce()` changes

```ts
// OLD (current):
async function produce() {
  // ... confirmation dialogs
  setPhase("uploading");
  const initRes = await fetch("/api/upload-init", {...});
  const { jobId, putUrl } = await initRes.json();
  // BLOCKING:
  await new Promise(...xhr.send(file)...);     // ← user waits here
  await fetch("/api/upload-complete", {jobId});
  addClientJob({jobId, filename, submittedAt});
  onJobQueued();   // page resets
}

// NEW:
async function produce() {
  // ... confirmation dialogs
  const initRes = await fetch("/api/upload-init", {...});
  const { jobId, putUrl } = await initRes.json();

  // Add to localStorage IMMEDIATELY so JobList shows the row in "uploading 0%" state
  addClientJob({jobId, filename, submittedAt});
  setLastAlignment({...lockedAlignment, fov});

  // Hand off to the background manager — fire and forget
  backgroundUploads.enqueue({
    id: jobId,
    putUrl,
    file,
    filename: file.name,
    size: file.size,
  });

  // Reset INSTANTLY — no awaiting upload
  onJobQueued();
}
```

The difference is `produce()` no longer awaits the upload XHR. It just enqueues into the manager and resets the page. The user is back at the upload zone within ~200ms (the time of one /api/upload-init round-trip).

### JobList changes

The JobList component currently polls `/api/jobs/list` for server-side status. It needs to:

1. **Also subscribe to `backgroundUploads`** so it can show client-side upload progress for jobs whose status is `pending-upload`
2. **For jobs in `pending-upload` state**, show one of three sub-states:
   - **Waiting in upload queue** (queued in the manager but not yet running)
   - **Uploading X%** (active in the manager, with live progress)
   - **Upload failed** (XHR errored — not in the manager, server has it as `pending-upload` still)
3. **For jobs in `queued` state or beyond**, behave exactly as before — the upload is done, the server has it.

The status glyph and label functions in JobList get extended:

```ts
function clientStatusOverlay(jobId: string, serverStatus: JobStatus): string {
  if (serverStatus !== "pending-upload") return serverStatus;  // server is the source of truth
  if (backgroundUploads.isActive(jobId)) {
    return `uploading-client`;  // new client-only state
  }
  if (backgroundUploads.isQueued(jobId)) {
    return `upload-queued`;     // new client-only state
  }
  return "pending-upload";  // server says pending, but client manager doesn't know about it (page reload, or genuinely failed)
}
```

The JobList row uses this combined status to render the right glyph and progress bar. For `uploading-client`, the progress bar shows the XHR progress; for everything else, it shows the server-reported progress.

### Server side

**No changes.** The server already supports `pending-upload` → `queued` via the existing `/api/upload-complete` endpoint. The server queue, worker, persistence, recovery, retry, all stay exactly as they are.

The 30-min `pending-upload` timeout in `ensureBoot()` already handles the "browser died mid-upload, never sent upload-complete" case.

---

## UI flow

### Single-file shape (current behaviour, unchanged)

User drops 1 file, aligns, hits Produce, sees the upload bar fill, sees the row appear in JobList → status flows through queue → eventually downloads. **Identical experience to today.** The new code path is just a special case of the multi-file flow with N=1.

### Multi-file shape (the new thing)

```
0:00  Drop file 1
0:02  Pick frame, align (manual: 30s)
0:32  Lock values, click Produce, confirm
0:32  Page resets instantly, JobList shows "file1.mp4 — uploading 0%"
0:32  Drop file 2
0:34  Pick frame, align (manual: 30s)
1:04  Lock values, click Produce, confirm
1:04  Page resets, JobList shows:
        file1.mp4 — uploading 47%   (or queued in upload manager if maxConcurrent=1 and file1 still going)
        file2.mp4 — upload-queued (or uploading 0%)
1:04  Drop file 3
... repeat ...

5:00  All 10 files dropped, all aligned, all submitted
5:00  JobList shows 10 rows, several in upload-queued, one uploading, server queue starting to fill
5:00+ User walks away
?:??  Wakes up to 10 green ↓ Get buttons
```

The user's interactive time is **5 minutes for 10 files** instead of 50+ minutes.

---

## Edge cases

| Case | Handling |
|---|---|
| Page reloaded mid-upload | The XHR dies. Server still has the job in `pending-upload` state. Boot recovery's 30-min timeout marks it failed. User can retry once a deploy or 30 min passes. No clean fix without Service Workers. **Document this loudly in the UI** — show "Don't reload during upload" warning when the upload manager has active jobs. |
| User clicks ✕ Dismiss on a job currently being uploaded by the manager | Manager aborts the XHR (`xhr.abort()`), removes the job from its queue, server `DELETE /api/job/:id` cleans the S3 prefix. Same as today's cancel. |
| User submits 30 jobs and the upload manager runs them at maxConcurrent=1 | Each one queues behind the previous in the manager. JobList shows them all in `upload-queued` state with a small "#3 in upload queue" hint. Eventually each one runs in turn. |
| Manager crashes or is in an inconsistent state | We don't catch this — it's an in-memory client component. Worst case the user reloads. The server has a copy of every submitted job, and the JobList displays whatever's in localStorage + whatever the server reports. Failed manager state just shows as "pending-upload" with no client progress info. |
| User submits a job, leaves the tab open for an hour, comes back | Manager has long since completed all uploads. JobList shows the current server state. No reconciliation needed. |
| `maxConcurrent` upgrade | Future: a UI control to set 1, 2, or 3 parallel uploads. Default 1 to avoid saturating typical home links. |

---

## File layout

```
src/
├── lib/
│   └── uploadManager.ts        ← NEW: BackgroundUploadManager singleton
└── components/
    ├── jobs/
    │   └── JobList.tsx         ← MODIFY: subscribe to manager, render upload-queued/uploading-client
    └── video/
        └── VideoSection.tsx    ← MODIFY: produce() hands off to manager and resets immediately
```

That's it. Three files.

---

## What this unblocks

- **The user's actual product**: drop 30, sleep, wake to greens
- **Future feature: Apply Last with quality toggles** — already done, but now genuinely useful because batch workflow exists
- **Future feature: bulk download** — once you have 30 completed jobs in the JobList, a "Download all" button is a natural next step

## What this does NOT do

- Doesn't change anything server-side
- Doesn't change the FFmpeg pipeline
- Doesn't survive a mid-upload page reload (Service Worker territory)
- Doesn't auto-clean failed `pending-upload` rows faster than the existing 30-min boot recovery

---

## Out of scope

- Service Worker / Background Fetch API for surviving page reloads during upload
- Multi-tab coordination of the upload manager
- Bulk download / zip stream
- Pause/resume of individual uploads
- Per-file priority reordering in the upload queue
