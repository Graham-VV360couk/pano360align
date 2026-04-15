# CLAUDE.md — Pano360Align

## What this project is

**Pano360Align** is a web-based 360° panorama horizon correction tool. It accepts either:
- A **still equirectangular image** — corrects and exports client-side
- A **360° equirectangular video** — user picks a reference frame, aligns it, server-side FFmpeg applies the correction to the entire video

Built for GeekyBee Ltd (geekybee.net) by G. Deployed to Coolify via Docker.

## Tech stack

- **Next.js 14** (App Router, TypeScript, Tailwind CSS)
- **Server:** Next.js API routes for upload, FFmpeg processing, progress (SSE), download
- **Processing:** FFmpeg `v360=e:e` filter with yaw/pitch/roll correction
- **Deployment:** Docker (node:20-alpine + FFmpeg), Coolify

## Relationship to PanoAlign / EquiRecover

This project shares alignment canvas logic with the **PanoAlign** tool in `D:\xampp\htdocs\EquiRecover`. The equirectangular ray-casting renderer, drag controls, and `projectHotspot()` function should be **ported directly** from that codebase — do not reinvent them.

Key files to port from EquiRecover:
- The render loop (ray-casting equirectangular projection)
- Mouse/touch drag → yaw/pitch control
- `screenToSpherical()` — use verbatim
- `projectHotspot()` — use verbatim (`asin(dx)` not `atan(dx/dz)`)

The **only additions** specific to this tool:
- Roll adjustment (third rotation matrix around Z axis)
- Straight-line overlay guide (CSS crosshair, not drawn into canvas)
- Input is a video frame capture, not a loaded image file
- Fixed FOV at 100° (no user FOV control)

## Visual style

- Dark theme: `#0a0a0f` background
- Cyan accent: `#00e5ff`
- Typography: Syne (headings/UI), DM Mono (values, labels, mono text)
- GeekyBee branding: bottom-right, always visible, `rgba(255,255,255,0.2)`

## Project structure

```
src/
├── app/
│   ├── page.tsx              ← Main page (client), composes all sections
│   ├── layout.tsx            ← Root layout + metadata
│   ├── globals.css           ← Tailwind + dark theme + fonts + slider styles
│   └── api/
│       ├── upload-init/route.ts       ← Creates a pending-upload job, returns presigned S3 PUT
│       ├── upload-complete/route.ts   ← Marks upload done, queues FFmpeg job
│       ├── download/[jobId]/route.ts  ← Redirects to presigned S3 GET
│       ├── jobs/list/route.ts         ← POST {ids[]} → job snapshots (polling endpoint)
│       ├── job/[jobId]/route.ts       ← DELETE cancels job
│       └── job/[jobId]/retry/route.ts ← POST re-runs a failed job
├── components/
│   ├── ui/                   ← Header, Footer
│   ├── upload/UploadZone.tsx ← Drag-and-drop, collapsed state
│   ├── alignment/
│   │   ├── AlignmentCanvas.tsx ← Equirectangular viewer, drag yaw/pitch, roll slider
│   │   ├── StillExport.tsx     ← Client-side full-res JPEG export
│   │   ├── LineList.tsx        ← (alignment helper — horizon line tools)
│   │   └── LineOverlay.tsx
│   ├── video/VideoSection.tsx  ← Scrubber, thumbnails, reference canvas, "Use this frame", produce
│   ├── jobs/JobList.tsx        ← Subscribes to uploadManager + polls /api/jobs/list
│   └── embed/EmbedGenerator.tsx ← Self-contained 360° embed code generator + live preview
└── lib/
    ├── equirect.ts           ← Ray-cast renderer (ported from EquiRecover)
    ├── jobs.ts               ← Server-side job queue, S3 I/O, FFmpeg spawn
    ├── s3.ts                 ← S3 helpers (presign, put/get JSON, list)
    ├── uploadManager.ts      ← Client-side BackgroundUploadManager singleton (XHR + progress)
    ├── clientJobs.ts         ← Client helpers for job polling / dismissal
    ├── clientAlignment.ts    ← Shared client alignment math
    └── lineMath.ts           ← Horizon-line math (with lineMath.test.ts)

docs/                         ← BRIEF, OVERVIEW, UI, SCRUBBER, ALIGNMENT, PROCESSING,
                                INFRASTRUCTURE, WARNINGS, QUALITY specs
```

## Current state — what's shipped

**Pipeline steps 1–5 are done** (end-to-end working):

- **Alignment canvas** — equirect ray-cast renderer (`lib/equirect.ts`), drag yaw/pitch, roll slider, guide overlay, keyboard controls. Roll sign is negated to match preview convention.
- **Still export** — full-resolution client-side JPEG with yaw/pitch/roll baked in.
- **Video scrubber + workflow** — thumbnail strip, scrub bar, reference canvas, "Use this frame" → alignment → "Produce" → job queued end-to-end.
- **FFmpeg pipeline** — `lib/jobs.ts` spawns FFmpeg with `v360=e:e`, streams to/from S3, in-memory queue persisted on `globalThis` to survive hot reload, per-job `highQuality` (CRF 12) and `highQualityInterp` (spline16) toggles.
- **Job queue UI** — `JobList` subscribes to `BackgroundUploadManager` for live upload progress, then polls `/api/jobs/list` (3s active / 15s idle) for server-side state. Survives navigation, not page reload. Server orphan timeout: 30 min.
- **Embed generator** — self-contained three.js embed code, live preview fed from a local file (blob URL, CORS-safe), layout presets (fixed / fullwidth / boxed / fullscreen), CSS units, FOV control.

**Warnings & edge cases (docs/WARNINGS.md):**
- W1 whole-file advisory — VideoSection.tsx (always visible, also references the trim toggle)
- W2 late reference frame (> 30s) — VideoSection.tsx
- W3 large file (> 2GB) — UploadZone.tsx
- W4 zero-values confirm — VideoSection.tsx (on Produce)
- W5 re-encode quality notice — VideoSection.tsx (dismissible, localStorage)

**S3 cleanup:** `sweepExpiredPendingUploads()` in `lib/jobs.ts` runs on boot and every 5 min. Expired pending-uploads are fully deleted from S3 + memory.

**Upload concurrency:** user-configurable 1–8 via the JobList header, persisted to localStorage (`pano360.maxConcurrent`). Default 1.

**Progress stream:** polling only (3s active, 15s idle). SSE removed from scope.

**Not shipped yet:**
- **Docker deploy verification** — Dockerfile + docker-compose.yml exist, FFmpeg+v360 baked in, but not proven in Coolify end-to-end.

## What to build next

### Production readiness
- Verify Docker build runs in Coolify with FFmpeg v360 available.
- Decide UX home for `EmbedGenerator` — currently always-visible at the bottom of `page.tsx`.

## Mouse control convention

This is a **viewer**, not a map:
- Drag right → view pans right (`yaw -= dx * sensitivity`)
- Drag up → view looks up (`pitch -= dy * sensitivity`)
- Scroll up → zoom in (but FOV is fixed at 100° for this tool)

## FFmpeg command

```bash
ffmpeg -i input.mp4 \
  -vf "v360=e:e:yaw={YAW}:pitch={PITCH}:roll={ROLL}:interp=lanczos" \
  -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p \
  -c:a copy -movflags +faststart \
  -metadata:s:v:0 spherical=true \
  output.mp4
```

Sign convention may need negation — test with a known tilted image.

## Non-negotiables

- All image processing happens in the browser. No server uploads for stills.
- Video processing is server-side FFmpeg only.
- Export must produce full-resolution output.
- `projectHotspot()` and `screenToSpherical()` ported verbatim from EquiRecover.
- Audio always passed through with `-c:a copy`.
- GeekyBee watermark always visible.

## Owner

GeekyBee Ltd — geekybee.net
Developer: G
