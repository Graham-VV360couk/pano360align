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
│   ├── page.tsx              ← Main page (client component, state management)
│   ├── layout.tsx            ← Root layout with metadata
│   ├── globals.css           ← Tailwind + dark theme + fonts + slider styles
│   └── api/
│       ├── upload/route.ts   ← File upload endpoint (WORKING)
│       ├── process/route.ts  ← FFmpeg job submission (STUB)
│       ├── progress/[jobId]/route.ts ← SSE progress stream (STUB)
│       ├── download/[jobId]/route.ts ← File download (STUB)
│       └── job/[jobId]/route.ts      ← Job cancellation (STUB)
├── components/
│   ├── ui/
│   │   ├── Header.tsx        ← App header with branding
│   │   └── Footer.tsx        ← GeekyBee footer link
│   ├── upload/
│   │   └── UploadZone.tsx    ← Drag-and-drop file upload (WORKING)
│   ├── alignment/
│   │   ├── AlignmentCanvas.tsx ← Equirectangular viewer + roll control (PLACEHOLDER)
│   │   └── StillExport.tsx     ← Export corrected image button (PLACEHOLDER)
│   ├── video/
│   │   └── VideoSection.tsx    ← Video workflow container (PLACEHOLDER)
│   └── scrubber/               ← Empty, for scrubber sub-components
├── lib/                        ← Empty, for shared utilities
└── api/                        ← Empty, for client-side API helpers
docs/
├── BRIEF.md          ← Original product briefing
├── OVERVIEW.md       ← Product scope and decisions
├── UI.md             ← Frontend spec (detailed layout, state table)
├── SCRUBBER.md       ← Video scrubber component spec
├── ALIGNMENT.md      ← Alignment canvas spec
├── PROCESSING.md     ← FFmpeg pipeline spec
├── INFRASTRUCTURE.md ← Docker / Coolify / API spec
├── WARNINGS.md       ← User-facing warnings spec
└── QUALITY.md        ← Output quality and encoding settings
```

## Current state — what's been done

1. Next.js 14 project scaffolded with TypeScript + Tailwind
2. Dark theme, fonts (Syne + DM Mono via Google Fonts), custom slider styles
3. Page layout wired: Header → UploadZone → AlignmentCanvas → StillExport/VideoSection → Footer
4. **UploadZone** is functional: drag-and-drop, file type detection, collapsed state with "Start again"
5. **AlignmentCanvas** has the UI shell: roll slider, live readout, reset button, guide lines toggle — but **no renderer yet**
6. **VideoSection** has the full UI skeleton: thumbnail strip placeholder, scrub bar, transport controls, reference canvas, "Use this frame", advisory, retrieve values, produce — all **placeholder/non-functional**
7. All **API routes** are stubbed with correct signatures and TODO comments
8. **Upload route** is functional (writes to temp dir, returns jobId)
9. Dockerfile and docker-compose.yml written per INFRASTRUCTURE.md spec
10. All spec docs copied to `docs/` for reference

## What to build next — in order

### Step 1: Alignment Canvas (the core)
Port the equirectangular ray-casting renderer from EquiRecover into `AlignmentCanvas.tsx`.
- Load image from `frameDataURL` prop
- Implement the render loop with yaw/pitch/roll
- Mouse drag for yaw/pitch (drag convention: drag-right = pan right, drag-up = look up)
- Roll applied as third rotation matrix (see docs/ALIGNMENT.md)
- Downsample input to max 4096x2048
- Guide line overlay (CSS, not canvas)
- Keyboard controls: arrows for yaw/pitch, Q/E for roll

### Step 2: Still Image Export
Implement `StillExport.tsx`:
- Render corrected image at full source resolution (not canvas size)
- Apply yaw/pitch/roll correction
- Trigger download as `{name}-aligned.jpg`
- Pure client-side, no server

### Step 3: Video Scrubber
Build out the scrubber sub-components in `src/components/scrubber/`:
- Hidden `<video>` element as decode source
- Thumbnail strip generation (progressive, background)
- Hover preview (240x135, throttled, with thumbnail fallback)
- Scrub bar with timecode
- Reference canvas (320x180)
- Transport controls (play/pause, frame step, 10s jump, playback rate)
- "Use this frame" button (captures at native resolution, downsamples to 4096x2048)

### Step 4: FFmpeg Processing Pipeline
Implement the server-side processing:
- `process/route.ts` — spawn FFmpeg with v360 filter
- `progress/[jobId]/route.ts` — parse FFmpeg stderr, stream SSE
- `download/[jobId]/route.ts` — stream output file
- `job/[jobId]/route.ts` — kill process, clean up
- In-memory job Map for v1
- File cleanup (input deleted after FFmpeg starts, output after 2hrs or download)

### Step 5: Wire Video Workflow End-to-End
Connect: scrubber → "Use this frame" → alignment canvas → "Retrieve values" → "Produce" → progress → download

### Step 6: Warnings and Edge Cases
Implement all warnings per docs/WARNINGS.md:
- Whole-file advisory (always visible)
- Late reference frame warning (> 30s)
- Large file warning (> 2GB)
- Zero values confirmation dialog
- Re-encoding quality notice (dismissible, localStorage)

### Step 7: Docker / Deploy
Test Docker build, verify FFmpeg v360 filter works in container, deploy to Coolify.

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
