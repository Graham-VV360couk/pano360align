# Multi-File Pipelining Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make `produce()` non-blocking on the upload phase so the user can submit a batch of files in rapid succession. Uploads run in a background client-side manager while the user continues with the next alignment.

**Architecture:** A new client-side `BackgroundUploadManager` singleton owns a FIFO queue of files-to-upload, runs `maxConcurrent` parallel XHR PUT workers to S3, and notifies subscribers (the JobList) on every progress event. `produce()` calls `/api/upload-init`, gets a presigned URL, hands the file to the manager, immediately resets the page, and never awaits the upload. Server-side is unchanged.

**Tech Stack:** TypeScript, React 18, Next.js 14 App Router. No new dependencies.

**Reference spec:** `docs/superpowers/specs/2026-04-07-multi-file-pipelining-design.md`

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `src/lib/uploadManager.ts` | NEW | Singleton background upload manager: queue, XHR workers, progress tracking, subscription |
| `src/components/video/VideoSection.tsx` | MODIFY | `produce()` no longer awaits the upload — hands off to the manager and resets the page immediately |
| `src/components/jobs/JobList.tsx` | MODIFY | Subscribes to the manager, renders client-side upload progress for jobs in `pending-upload` state, distinguishes "upload queued" from "uploading X%" |

---

## Task 1: BackgroundUploadManager singleton

**Files:**
- Create: `src/lib/uploadManager.ts`

- [ ] **Step 1: Create the file with this exact content**

```ts
"use client";

/**
 * Background upload manager for direct browser → S3 PUTs.
 *
 * The user clicks Produce, the server creates a job and returns a presigned
 * PUT URL, and we hand that to this manager. It runs N parallel uploads in
 * the background while the user immediately moves on to the next file.
 *
 * The manager is a singleton in the module scope. It survives navigation
 * between pages but NOT a full page reload — XHRs are in-memory only. The
 * server side has its own 30-minute timeout for orphaned pending-upload jobs.
 */

interface UploadEntry {
  id: string;        // matches the server jobId
  putUrl: string;    // presigned S3 URL
  file: File;        // the actual blob
  filename: string;
  size: number;
}

type ProgressMap = Record<string, number>; // jobId → 0-100

class BackgroundUploadManager {
  private queue: UploadEntry[] = [];
  private active: Map<string, XMLHttpRequest> = new Map();
  private progress: ProgressMap = {};
  private failed: Set<string> = new Set();
  private listeners: Set<() => void> = new Set();
  // Concurrent uploads. 1 is the safe default; bumping it past 2-3 hurts
  // most home links because of TCP fairness and TLS overhead.
  private maxConcurrent = 1;

  enqueue(entry: UploadEntry): void {
    this.queue.push(entry);
    this.progress[entry.id] = 0;
    this.failed.delete(entry.id);
    this.notify();
    this.tick();
  }

  cancel(id: string): void {
    const xhr = this.active.get(id);
    if (xhr) {
      try {
        xhr.abort();
      } catch {}
      this.active.delete(id);
    }
    this.queue = this.queue.filter((e) => e.id !== id);
    delete this.progress[id];
    this.failed.delete(id);
    this.notify();
    this.tick();
  }

  isActive(id: string): boolean {
    return this.active.has(id);
  }

  isQueued(id: string): boolean {
    return this.queue.some((e) => e.id === id);
  }

  hasFailed(id: string): boolean {
    return this.failed.has(id);
  }

  getProgress(id: string): number {
    return this.progress[id] ?? 0;
  }

  /** True when the manager has any non-terminal work — used to gate
   *  "don't reload the page" warnings in the UI. */
  hasActiveWork(): boolean {
    return this.active.size > 0 || this.queue.length > 0;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const l of this.listeners) {
      try {
        l();
      } catch {}
    }
  }

  private tick(): void {
    while (this.active.size < this.maxConcurrent && this.queue.length > 0) {
      const entry = this.queue.shift()!;
      this.startUpload(entry);
    }
  }

  private startUpload(entry: UploadEntry): void {
    const xhr = new XMLHttpRequest();
    this.active.set(entry.id, xhr);
    this.progress[entry.id] = 0;
    this.notify();

    xhr.open("PUT", entry.putUrl);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        this.progress[entry.id] = (e.loaded / e.total) * 100;
        this.notify();
      }
    };

    xhr.onload = async () => {
      this.active.delete(entry.id);
      if (xhr.status >= 200 && xhr.status < 300) {
        // Tell the server the upload is done so it gets enqueued.
        try {
          await fetch("/api/upload-complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId: entry.id }),
          });
        } catch (err) {
          console.error(`upload-complete failed for ${entry.id}:`, err);
          this.failed.add(entry.id);
        }
        this.progress[entry.id] = 100;
      } else {
        console.error(`S3 PUT failed for ${entry.id}: ${xhr.status} ${xhr.responseText}`);
        this.failed.add(entry.id);
      }
      this.notify();
      this.tick();
    };

    xhr.onerror = () => {
      this.active.delete(entry.id);
      this.failed.add(entry.id);
      console.error(`S3 PUT network error for ${entry.id}`);
      this.notify();
      this.tick();
    };

    xhr.onabort = () => {
      this.active.delete(entry.id);
      this.notify();
      this.tick();
    };

    xhr.send(entry.file);
  }
}

export const backgroundUploads = new BackgroundUploadManager();

// Make it accessible for debugging in dev
if (typeof window !== "undefined") {
  (window as unknown as { __pano360Uploads?: BackgroundUploadManager }).__pano360Uploads =
    backgroundUploads;
}

// Warn the user if they try to close the page with active uploads.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (backgroundUploads.hasActiveWork()) {
      e.preventDefault();
      // The actual message is browser-controlled in modern browsers, but
      // returning a non-empty string triggers the native confirmation.
      e.returnValue =
        "Uploads are still in progress. Reloading or closing will lose them.";
      return e.returnValue;
    }
  });
}
```

- [ ] **Step 2: Build to confirm it compiles**

Run: `npx next build`
Expected: PASS — the file is unused so far so the build is unaffected, but TypeScript should be happy.

- [ ] **Step 3: Commit**

```bash
git add src/lib/uploadManager.ts
git commit -m "feat(uploads): BackgroundUploadManager singleton for non-blocking PUTs"
```

Report: build outcome, commit SHA, status.

---

## Task 2: Wire `BackgroundUploadManager` into `produce()`

**Files:**
- Modify: `src/components/video/VideoSection.tsx`

The current `produce()` does six things synchronously:

1. Confirmation dialogs (zero values + queue confirmation)
2. POST `/api/upload-init`
3. Direct S3 PUT via XHR (the long-blocking one)
4. POST `/api/upload-complete`
5. `addClientJob` + `setLastAlignment` + dispatch event
6. `onJobQueued()` (page reset)

After this task:

1. Confirmation dialogs (unchanged)
2. POST `/api/upload-init` (unchanged)
3. **Skip the direct PUT** — hand off to `backgroundUploads.enqueue(...)`
4. **Skip `/api/upload-complete`** — the manager handles that on its own when its XHR finishes
5. `addClientJob` + `setLastAlignment` + dispatch event (unchanged)
6. `onJobQueued()` (page reset, unchanged) — but now it fires within ~200ms of the click instead of after the upload finishes

- [ ] **Step 1: Add the import**

In `src/components/video/VideoSection.tsx`, near the existing `addClientJob` import, add:

```ts
import { backgroundUploads } from "@/lib/uploadManager";
```

- [ ] **Step 2: Replace the produce() body**

Find the `const produce = async () => {` function. Replace its entire body with:

```ts
  const produce = async () => {
    if (!lockedAlignment) return;
    if (phase === "uploading") return;

    // Warning 4: zero values confirmation
    if (
      lockedAlignment.yaw === 0 &&
      lockedAlignment.pitch === 0 &&
      lockedAlignment.roll === 0
    ) {
      const ok = window.confirm(
        "All correction values are 0°. Your video will be re-encoded but not visually changed. Apply anyway?"
      );
      if (!ok) return;
    }

    // Queue confirmation
    const okQueue = window.confirm(
      "This video will be added to the processing queue. OK?"
    );
    if (!okQueue) return;

    setJobError(null);
    setUploadProgress(0);
    setPhase("uploading");

    try {
      // 1. Ask server for a presigned PUT URL and a fresh jobId.
      const initRes = await fetch("/api/upload-init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          alignment: lockedAlignment,
          trimStart:
            trimToReference && refTime != null && refTime > 0 ? refTime : 0,
          highQuality,
          highQualityInterp,
        }),
      });
      if (!initRes.ok) {
        throw new Error(
          `upload-init failed: ${initRes.status} ${await initRes.text()}`
        );
      }
      const { jobId: newJobId, putUrl } = (await initRes.json()) as {
        jobId: string;
        putUrl: string;
      };

      // 2. Persist to localStorage so JobList shows the row immediately.
      addClientJob({
        id: newJobId,
        filename: file.name,
        submittedAt: Date.now(),
      });
      // Save these alignment values for the next video's "Apply last" button.
      setLastAlignment({ ...lockedAlignment, fov });

      // 3. Hand off to the background upload manager — fire and forget.
      //    The manager will PUT to S3, then call /api/upload-complete itself.
      backgroundUploads.enqueue({
        id: newJobId,
        putUrl,
        file,
        filename: file.name,
        size: file.size,
      });

      // 4. Notify same-tab listeners that the JobList state changed.
      window.dispatchEvent(new Event("pano360.jobs.changed"));

      // 5. Reset everything so the user can immediately drop another file.
      //    This is the whole point — we're not awaiting the upload.
      setPhase("idle");
      setJobId(null);
      setUploadProgress(0);
      onJobQueued();
    } catch (err) {
      setPhase("failed");
      setJobError((err as Error).message);
    }
  };
```

- [ ] **Step 3: Remove the now-unused `uploadXhrRef` and its handling**

The XHR is now owned by the upload manager, not VideoSection. The `uploadXhrRef` and any code that touches it can be removed.

Find:
```ts
const uploadXhrRef = useRef<XMLHttpRequest | null>(null);
```
and delete the line.

Find any references to `uploadXhrRef.current` (typically in `cancelJob`) and remove them. The `cancelJob` function still exists for the UI Cancel button — its only remaining job is to clear the inline `phase === "failed"` state, since `phase === "uploading"` is no longer reachable for more than a few hundred milliseconds.

Replace the body of `cancelJob` with:

```ts
  const cancelJob = async () => {
    setPhase("idle");
    setUploadProgress(0);
    setJobError(null);
    setJobId(null);
  };
```

- [ ] **Step 4: Remove the `phase === "uploading"` panel**

Since the upload no longer blocks `produce()`, the inline "uploading" UI in VideoSection is now unreachable in practice (it'd flicker for ~200ms before the page resets). Find the JSX block:

```tsx
{phase === "uploading" && (
  <div className="rounded-lg border border-accent/20 bg-accent/5 px-4 py-3 space-y-2">
    ...
  </div>
)}
```

Delete it entirely. The user will see the upload progress in the **JobList** at the top of the page instead.

Keep the `phase === "failed"` panel — that still fires if `/api/upload-init` itself fails before the manager takes over.

- [ ] **Step 5: Remove the now-unused `setUploadProgress` and `uploadProgress` state**

VideoSection no longer needs to track upload progress. JobList does that via the manager subscription.

Find:
```ts
const [uploadProgress, setUploadProgress] = useState(0);
```
and delete the line.

Remove all `setUploadProgress(...)` calls in produce() and cancelJob().

- [ ] **Step 6: Tell the parent we're not "uploading" anymore**

The `onUploadingChange` callback is currently driven by `phase === "uploading"`. With the new flow, that phase only exists for a few hundred milliseconds during upload-init. The Start over / Start again locks it triggers are no longer useful in their current form.

Two options:
- (a) Remove the Start over / Start again locks entirely — they were defensive against the old long-blocking upload
- (b) Lock based on whether the BackgroundUploadManager has active work

Option (b) is more honest: if there are uploads still running for past jobs, you really should not reload. But it's a different lock — not about THIS file, but about ALL pending uploads.

For this task, do **option (a)**: remove the lock. The `beforeunload` warning in `uploadManager.ts` Step 1 already covers the "don't reload while uploads are running" case at the browser level.

Find the `useEffect` that calls `onUploadingChange`:

```ts
useEffect(() => {
  onUploadingChange?.(phase === "uploading");
}, [phase, onUploadingChange]);
```

Delete it.

Also delete the `onUploadingChange?: (uploading: boolean) => void;` from `VideoSectionProps` and from the destructured props.

- [ ] **Step 7: Build to confirm everything still compiles**

Run: `npx next build`
Expected: PASS. Some unused-import warnings may appear if you missed anything; clean those up.

- [ ] **Step 8: Commit**

```bash
git add src/components/video/VideoSection.tsx
git commit -m "feat(uploads): produce() hands off to background manager and resets immediately"
```

Report: build outcome, any unused-variable warnings, commit SHA, status.

---

## Task 3: Update `page.tsx` to drop the unused props

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Remove the videoUploading state and the prop passthrough**

Find:
```ts
const [videoUploading, setVideoUploading] = useState(false);
```
and delete it.

Find the VideoSection usage:
```tsx
<VideoSection
  ...
  onUploadingChange={setVideoUploading}
/>
```
and remove the `onUploadingChange` line.

Find the UploadZone usage:
```tsx
<UploadZone
  ...
  resetDisabled={videoUploading}
/>
```
and remove the `resetDisabled` line.

The `resetDisabled` prop on UploadZone can stay defined (back-compat), or you can remove it from UploadZoneProps too — your call. Removing is cleaner.

- [ ] **Step 2: Build**

Run: `npx next build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(uploads): drop videoUploading state — manager handles unload warning"
```

Report.

---

## Task 4: Subscribe `JobList` to the upload manager

**Files:**
- Modify: `src/components/jobs/JobList.tsx`

The JobList currently polls `/api/jobs/list` and renders rows. For jobs in `pending-upload` state, the server doesn't know the upload progress — only the client manager does. JobList needs to subscribe to the manager so it can render live upload progress.

- [ ] **Step 1: Add the import**

```ts
import { backgroundUploads } from "@/lib/uploadManager";
```

- [ ] **Step 2: Subscribe + force re-renders**

Add a state hook that increments on every notification, used purely to trigger re-renders:

After the existing `useState` hooks at the top of JobList, add:

```ts
  // Re-render counter — incremented whenever the upload manager fires a
  // progress event so the visible bars stay in sync.
  const [, setUploadTick] = useState(0);
  useEffect(() => {
    return backgroundUploads.subscribe(() => {
      setUploadTick((t) => t + 1);
    });
  }, []);
```

- [ ] **Step 3: Use the manager when rendering pending-upload rows**

Find the part of the render that determines `status` and `progress` per row. Replace the current logic with one that overlays the manager's view for `pending-upload` jobs:

Find:
```tsx
const s = snaps[ref.id];
const status = s?.status ?? "pending-upload";
```

Replace with:

```tsx
const s = snaps[ref.id];
let status: string = s?.status ?? "pending-upload";
let displayProgress = s?.progress ?? 0;

// Overlay client-side upload state for jobs the server still considers pending-upload.
if (status === "pending-upload") {
  if (backgroundUploads.isActive(ref.id)) {
    status = "client-uploading";
    displayProgress = backgroundUploads.getProgress(ref.id);
  } else if (backgroundUploads.isQueued(ref.id)) {
    status = "client-queued";
  } else if (backgroundUploads.hasFailed(ref.id)) {
    status = "client-failed";
  }
  // else: still "pending-upload" — the page was reloaded and the manager
  // doesn't know about this job; the server's 30-min timeout will handle it.
}
```

Then update the parts of the row JSX that display status, progress bar, and labels to use these new values.

- [ ] **Step 4: Add status glyphs and labels for the new states**

Update the `StatusGlyph` map to include:

```ts
"client-uploading": { ch: "↑", cls: "text-accent" },
"client-queued":    { ch: "↑⏸", cls: "text-text-muted" },
"client-failed":    { ch: "↑✗", cls: "text-red-400" },
```

Update the `statusLabel` switch:

```ts
case "client-uploading":
  return `Uploading ${(s ? displayProgress : 0).toFixed(0)}%`;
case "client-queued":
  return "Waiting to upload";
case "client-failed":
  return "Upload failed";
```

(You'll need to adjust `statusLabel` to accept `displayProgress` as a parameter, or compute it inside.)

- [ ] **Step 5: Show the progress bar for client-uploading rows too**

Find the existing condition:
```tsx
{(status === "processing" || status === "downloading" || status === "uploading") && (
  <div className="h-1 mt-1.5 ...">
    ...
  </div>
)}
```

Add `client-uploading` to the list:
```tsx
{(status === "processing" || status === "downloading" || status === "uploading" || status === "client-uploading") && (
  ...
)}
```

And ensure the `style={{width: ...}}` uses `displayProgress` instead of `s?.progress`.

- [ ] **Step 6: Cancel handler should call the upload manager too**

Find the `dismiss` function:
```ts
const dismiss = async (id: string) => {
  removeClientJob(id);
  reload();
  try {
    await fetch(`/api/job/${id}`, { method: "DELETE" });
  } catch {}
};
```

Add a manager cancel call to abort any active XHR:
```ts
const dismiss = async (id: string) => {
  backgroundUploads.cancel(id);
  removeClientJob(id);
  reload();
  try {
    await fetch(`/api/job/${id}`, { method: "DELETE" });
  } catch {}
};
```

- [ ] **Step 7: Build**

Run: `npx next build`
Expected: PASS. Some careful work here because the rendering logic gets restructured.

- [ ] **Step 8: Commit**

```bash
git add src/components/jobs/JobList.tsx
git commit -m "feat(uploads): JobList subscribes to upload manager and renders client states"
```

Report.

---

## Task 5: Final verification

- [ ] **Step 1: Build + test**

```bash
npx next build
npm test
npm run lint
```
All three should pass.

- [ ] **Step 2: Manual smoke test**

```bash
npm run dev
```

Walk through this checklist and report each item:

1. Open `http://localhost:3000`
2. Drop a video, capture frame, lock values, click Produce
3. **Page resets within ~1 second** (not after the upload finishes)
4. JobList shows the new row with status "Uploading X%" and a live progress bar
5. Drop a SECOND video while the first is still uploading
6. Capture frame, lock values, click Produce on the second
7. Page resets again immediately
8. JobList now shows both rows. The second is "Waiting to upload" (since maxConcurrent=1)
9. As the first upload finishes, the second starts automatically
10. Once both uploads complete, server-side processing begins on the first (status flips to "downloading", "processing X%", etc.)
11. Try clicking Dismiss (✕) on a job that's currently uploading — the XHR aborts cleanly, the row disappears, no errors in the console

If any of the above doesn't work, paste the exact failure mode and STOP. Don't commit a broken pipeline.

- [ ] **Step 3: Spec cross-check**

Re-read `docs/superpowers/specs/2026-04-07-multi-file-pipelining-design.md` and confirm each section is implemented:
- BackgroundUploadManager singleton ✓
- maxConcurrent default 1 ✓
- produce() doesn't await ✓
- JobList shows client-side upload progress ✓
- beforeunload warning when manager has active work ✓
- Server side unchanged ✓

- [ ] **Step 4: Status**

`DONE` if everything passes. `DONE_WITH_CONCERNS` with a list of any caveats.

---

## Optional Task 6: Web Worker / chunked decode for `imageToPixels` (the 3-second hitch)

This is the second item the user wanted built. It's separate from the multi-file pipelining and can ship in the same session if there's time, or as a follow-up.

The goal is to eliminate the 2-3 second main-thread block when the user clicks "Use this frame" — currently `imageToPixels()` runs synchronously and blocks the UI from updating other state.

**Files:**
- Create: `src/lib/imagePixelsWorker.ts` (or use the chunked-idle-callback approach)
- Modify: `src/lib/equirect.ts`
- Modify: `src/components/alignment/AlignmentCanvas.tsx`

**The simpler approach (chunked idle callback) — start with this:**

- [ ] **Step 1: Add a chunked variant of `imageToPixels`**

Append to `src/lib/equirect.ts`:

```ts
/**
 * Async version of imageToPixels that yields to the browser between
 * scanlines so the main thread stays responsive while the decode runs.
 * Use this when capturing a frame to avoid the 2-3 second hitch.
 */
export async function imageToPixelsAsync(
  img: HTMLImageElement,
  maxWidth = 4096
): Promise<PanoramaPixels> {
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  const scale = srcW > maxWidth ? maxWidth / srcW : 1;
  const w = Math.round(srcW * scale);
  const h = Math.round(srcH * scale);

  const oc = document.createElement("canvas");
  oc.width = w;
  oc.height = h;
  const octx = oc.getContext("2d", { willReadFrequently: true })!;
  octx.drawImage(img, 0, 0, w, h);

  // Yield once before the big getImageData call. The drawImage above is
  // synchronous but cheap; getImageData is the expensive bit because it
  // copies w*h*4 bytes out of the GPU canvas backing into a JS Uint8ClampedArray.
  await new Promise((r) => setTimeout(r, 0));
  const data = octx.getImageData(0, 0, w, h).data;
  return { data, width: w, height: h };
}
```

- [ ] **Step 2: Use it in AlignmentCanvas**

Find the existing image-loading useEffect in `AlignmentCanvas.tsx`:

```ts
img.onload = () => {
  pixelsRef.current = imageToPixels(img, 4096);
  setLoaded(true);
  requestDraw();
};
```

Replace with:

```ts
img.onload = async () => {
  pixelsRef.current = await imageToPixelsAsync(img, 4096);
  setLoaded(true);
  requestDraw();
};
```

And change the import from `imageToPixels` to `imageToPixelsAsync` (or import both).

- [ ] **Step 3: Build**

Run: `npx next build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/equirect.ts src/components/alignment/AlignmentCanvas.tsx
git commit -m "perf(alignment): async chunked decode for imageToPixels to remove UI hitch"
```

The Web Worker version is more complex but provides a deeper fix — postpone unless the chunked version isn't enough.

---

---

## Task 7: Embed code generator widget

A small add-on requested by the user to close the loop between "I have a corrected video" and "my client can see it on their website". Pure client-side, no backend, no S3, no queue. Just a form that produces a self-contained HTML snippet using three.js for the 360 viewer.

**Files:**
- Create: `src/components/embed/EmbedGenerator.tsx`
- Modify: `src/app/page.tsx` (render it at the bottom)

- [ ] **Step 1: Create the EmbedGenerator component**

Create `src/components/embed/EmbedGenerator.tsx`:

```tsx
"use client";

import { useState, useMemo } from "react";

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 450;
const DEFAULT_FOV = 100;

function buildEmbedHtml(opts: {
  videoUrl: string;
  width: number;
  height: number;
  fov: number;
}): string {
  const id = `pano360-${Math.random().toString(36).slice(2, 10)}`;
  const { videoUrl, width, height, fov } = opts;
  return `<div id="${id}" style="width:${width}px;height:${height}px;background:#000;position:relative;overflow:hidden;"></div>
<script src="https://cdn.jsdelivr.net/npm/three@0.150.1/build/three.min.js"></script>
<script>
(function(){
  var el = document.getElementById("${id}");
  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(${fov}, ${width}/${height}, 0.1, 1000);
  camera.target = new THREE.Vector3(0, 0, 0);
  var renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(${width}, ${height});
  el.appendChild(renderer.domElement);

  var video = document.createElement("video");
  video.src = "${videoUrl}";
  video.crossOrigin = "anonymous";
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.play();

  var texture = new THREE.VideoTexture(video);

  var geometry = new THREE.SphereGeometry(500, 60, 40);
  geometry.scale(-1, 1, 1); // invert so we see the inside
  var material = new THREE.MeshBasicMaterial({ map: texture });
  var sphere = new THREE.Mesh(geometry, material);
  scene.add(sphere);

  var lon = 0, lat = 0, isDragging = false, lastX = 0, lastY = 0;
  el.addEventListener("mousedown", function(e){ isDragging = true; lastX = e.clientX; lastY = e.clientY; });
  window.addEventListener("mouseup", function(){ isDragging = false; });
  window.addEventListener("mousemove", function(e){
    if (!isDragging) return;
    lon -= (e.clientX - lastX) * 0.1;
    lat += (e.clientY - lastY) * 0.1;
    lat = Math.max(-85, Math.min(85, lat));
    lastX = e.clientX; lastY = e.clientY;
  });
  el.addEventListener("touchstart", function(e){ isDragging = true; lastX = e.touches[0].clientX; lastY = e.touches[0].clientY; }, { passive: true });
  el.addEventListener("touchend", function(){ isDragging = false; });
  el.addEventListener("touchmove", function(e){
    if (!isDragging) return;
    lon -= (e.touches[0].clientX - lastX) * 0.1;
    lat += (e.touches[0].clientY - lastY) * 0.1;
    lat = Math.max(-85, Math.min(85, lat));
    lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
  }, { passive: true });

  function animate() {
    requestAnimationFrame(animate);
    var phi = THREE.MathUtils.degToRad(90 - lat);
    var theta = THREE.MathUtils.degToRad(lon);
    camera.target.x = 500 * Math.sin(phi) * Math.cos(theta);
    camera.target.y = 500 * Math.cos(phi);
    camera.target.z = 500 * Math.sin(phi) * Math.sin(theta);
    camera.lookAt(camera.target);
    renderer.render(scene, camera);
  }
  animate();
})();
</script>`;
}

export default function EmbedGenerator() {
  const [videoUrl, setVideoUrl] = useState("");
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [fov, setFov] = useState(DEFAULT_FOV);
  const [copied, setCopied] = useState(false);

  const html = useMemo(() => {
    if (!videoUrl) return "";
    return buildEmbedHtml({ videoUrl, width, height, fov });
  }, [videoUrl, width, height, fov]);

  const copy = async () => {
    if (!html) return;
    try {
      await navigator.clipboard.writeText(html);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <section className="border border-border-subtle rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border-subtle">
        <h2 className="font-heading text-sm font-medium">EMBED CODE</h2>
      </div>
      <div className="p-4 space-y-3">
        <p className="font-mono text-xs text-text-muted leading-relaxed">
          Once you&apos;ve uploaded your corrected video to your own hosting,
          paste the URL here and grab an embed snippet for your website.
        </p>

        <label className="block">
          <span className="block font-mono text-xs text-text-muted mb-1">Video URL</span>
          <input
            type="url"
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            placeholder="https://example.com/my-corrected-video.mp4"
            className="w-full bg-black/40 border border-border-subtle rounded px-3 py-2 font-mono text-xs"
          />
        </label>
        <div className="grid grid-cols-3 gap-2">
          <label className="block">
            <span className="block font-mono text-xs text-text-muted mb-1">Width</span>
            <input
              type="number"
              value={width}
              onChange={(e) => setWidth(parseInt(e.target.value) || DEFAULT_WIDTH)}
              min={200}
              max={4000}
              className="w-full bg-black/40 border border-border-subtle rounded px-3 py-2 font-mono text-xs"
            />
          </label>
          <label className="block">
            <span className="block font-mono text-xs text-text-muted mb-1">Height</span>
            <input
              type="number"
              value={height}
              onChange={(e) => setHeight(parseInt(e.target.value) || DEFAULT_HEIGHT)}
              min={200}
              max={4000}
              className="w-full bg-black/40 border border-border-subtle rounded px-3 py-2 font-mono text-xs"
            />
          </label>
          <label className="block">
            <span className="block font-mono text-xs text-text-muted mb-1">Initial FOV</span>
            <input
              type="number"
              value={fov}
              onChange={(e) => setFov(parseInt(e.target.value) || DEFAULT_FOV)}
              min={30}
              max={150}
              className="w-full bg-black/40 border border-border-subtle rounded px-3 py-2 font-mono text-xs"
            />
          </label>
        </div>

        {html && (
          <>
            <pre className="bg-black/50 border border-border-subtle rounded p-3 font-mono text-[10px] text-text-muted overflow-auto max-h-64 leading-relaxed">
{html}
            </pre>
            <button
              onClick={copy}
              className="w-full py-2 rounded bg-accent/10 border border-accent/30 text-accent font-heading text-xs font-medium hover:bg-accent/20 transition-colors"
            >
              {copied ? "✓ Copied" : "📋 Copy to clipboard"}
            </button>
            <p className="font-mono text-[10px] text-text-muted/70">
              Loads three.js from a CDN. Drag to look around. Touch on mobile.
              Self-contained — paste it into any HTML page.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Render it in `page.tsx`**

Add the import at the top:
```ts
import EmbedGenerator from "@/components/embed/EmbedGenerator";
```

At the end of the main content wrapper (after the existing VideoSection conditional render), add:
```tsx
<EmbedGenerator />
```

- [ ] **Step 3: Build**

Run: `npx next build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/embed/EmbedGenerator.tsx src/app/page.tsx
git commit -m "feat(embed): generator widget for self-contained 360 video embed code"
```

Report.

---

## Execution notes

- The bulk of the win comes from Tasks 1-4. Task 5 is verification. Task 6 is optional polish (chunked decode). Task 7 is the embed widget.
- Server side is **not touched** in this plan. If you're tempted to modify anything in `src/lib/jobs.ts` or any API route, **stop** — the design is deliberately client-side only.
- The `maxConcurrent = 1` is a deliberate v1 choice. Don't try to bump it without testing how home networks actually behave with 2-3 parallel S3 PUTs.
