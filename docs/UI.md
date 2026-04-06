# UI.md — Frontend Spec

## Product name

**Pano360Align**

## Architecture

Single page. Single URL. One tool that accepts either a still image or a video. No tabs, no stages, no separate screens. Everything lives on the page and sections reveal themselves as needed.

---

## Page layout (top to bottom)

```
┌─────────────────────────────────────────────────────────────┐
│  PANO360ALIGN                          pano360align.com     │
│  360° panorama horizon correction                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                   UPLOAD ZONE                               │
│         [ Drop an image or video here ]                     │
│         JPG · PNG · WebP  /  MP4 · MOV                     │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                 ALIGNMENT CANVAS                            │
│         (hidden until a file is loaded)                     │
│                                                             │
│   Drag to look around. Adjust roll until a straight         │
│   line in the scene appears straight.                       │
│                                                             │
│   YAW: +12.4°    PITCH: -3.1°    ROLL: +0.8°               │
│   [──────────── Roll slider ────────────]                   │
│   [ Reset ]  [ Guide lines: on/off ]                        │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ▼ STILL IMAGE EXPORT  (shown for image uploads only)       │
│  [ Export corrected image ]                                 │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ▼ VIDEO  (shown for video uploads only)                    │
│                                                             │
│  [thumbnail strip — full width]                             │
│  [reference canvas]  [transport controls]  [timecode]       │
│  [ USE THIS FRAME ]   Reference frame: 00:12:34             │
│                                                             │
│  ⚠ Advisory: values apply to entire video                   │
│                                                             │
│  [ Retrieve Alignment Values ]                              │
│  Yaw: +12.4°   Pitch: -3.1°   Roll: +0.8°                  │
│                                                             │
│  [ Produce ]                                                │
│                                                             │
│  ████████████████░░░░░░  62%   ~4 min remaining            │
│  [ Cancel ]                                                 │
│                                                             │
│  [ ✓ Download corrected video — original-aligned.mp4 ]      │
│  [ Start again ]                                            │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                              geekybee.net  │
└─────────────────────────────────────────────────────────────┘
```

---

## Upload zone

- Full-width drag-and-drop zone
- Single file only
- Accepted: `image/jpeg`, `image/png`, `image/webp`, `image/avif`, `video/mp4`, `video/quicktime`
- On file drop or selection: detect type (image vs video), reveal appropriate sections
- Display: filename, file size, duration (video only)
- File size advisory (not a block): > 2GB → show estimated processing time warning

### File type detection

```javascript
const isVideo = file.type.startsWith('video/');
const isImage = file.type.startsWith('image/');
```

- Image → load directly into alignment canvas, show Still Image Export section
- Video → show Video section, begin thumbnail generation, hide Still Image Export section
- Neither → reject with friendly message

---

## Alignment canvas

- Hidden on page load, revealed once a file is loaded
- Behaviour: see ALIGNMENT.md
- Receives either:
  - A loaded image file (still workflow)
  - A captured video frame passed from the scrubber (video workflow)
- The canvas has no knowledge of which workflow is active — it just receives an image
- On new frame received: resets yaw, pitch, roll to 0 and re-renders
- Roll slider lives below the canvas, full-width
- Guide lines toggle: horizontal + vertical crosshair overlay
- Live YAW / PITCH / ROLL readout updates on every render frame

---

## Still image export section

Shown only when a still image is uploaded. Hidden for video.

- "Export corrected image" button
- On click: renders the current canvas view at full source resolution, triggers download
- Output filename: `{original-name}-aligned.jpg`
- No server required — pure client-side canvas operation

---

## Video section

Shown only when a video is uploaded. Hidden for stills. Revealed immediately on video load — does not wait for thumbnail generation.

### Sub-sections within Video (in order)

**1. Scrubber**
See SCRUBBER.md for full detail. Contains:
- Thumbnail strip with hover preview
- Reference canvas (small, 320×180)
- Transport controls
- "Use this frame" button + reference frame timecode display

**2. Advisory (always visible once video is loaded)**

> ⚠️ **These values will be applied to every frame of your video** — from the very first to the very last. If your video contains setup footage or camera movement, those frames will also be corrected. Trim your source file first if needed.

Not dismissible. Always visible. Small, not alarming.

**3. Retrieve Alignment Values**

Button: `[ Retrieve Alignment Values ]`

- Only active after "Use this frame" has been clicked at least once
- On click: reads current YAW / PITCH / ROLL from the alignment canvas
- Displays the retrieved values below the button:
  ```
  Yaw: +12.4°    Pitch: -3.1°    Roll: +0.8°
  ```
- If all values are 0.0°: show inline warning — "All values are zero — nothing will be corrected. Go back and align the canvas first."
- User can re-align and retrieve again at any time before hitting Produce

**4. Produce button**

Button: `[ Produce ]`

- Only active after alignment values have been retrieved
- On click: submits job to server (jobId + values + video file reference)
- Button becomes disabled + shows spinner while job runs

**5. Progress**

- Progress bar, full width
- Percentage and estimated time remaining (from FFmpeg stderr parsing via SSE)
- "Cancel" link — cancels job server-side, resets to pre-Produce state, preserves alignment values

**6. Download**

Appears on job completion, replaces progress bar:

- `[ ✓ Download corrected video ]` — primary button, triggers file download
- Filename: `{original-name}-aligned.mp4`
- File size displayed
- Summary: "Corrected with Yaw +12.4° / Pitch -3.1° / Roll +0.8°"
- "Start again" link — clears everything, returns to fresh upload state

**7. Error state**

Replaces progress bar on failure:

- Plain language error message (no raw FFmpeg output)
- "Try again" link — returns to pre-Produce state, preserves alignment values

---

## Public-facing notices

### On the upload zone (always visible)

> **For static, tripod-mounted 360° cameras only.**  
> Export your video as a full equirectangular MP4 from your camera app first.  
> Do not use reframed, "magic window", or rectilinear exports.  
> This tool will not work correctly on handheld or moving camera footage.

Small text, below the drop zone. Not a warning — just factual guidance. Visible before the user has done anything.

---

## Visual style

- Dark theme throughout — `#0a0a0f` background
- Cyan accent (`#00e5ff`) for primary actions and highlights
- Typography: Syne (headings/UI), DM Mono (values, labels, code)
- Consistent with existing GeekyBee tools and the 360° viewer
- Section dividers: subtle `rgba(255,255,255,0.06)` border
- Sections reveal with a simple fade-in — no dramatic animations

---

## Geekybee branding

- `geekybee.net` — bottom-right corner of page
- Font: DM Mono, 0.6rem, `rgba(255,255,255,0.2)` opacity
- Links to geekybee.net in a new tab
- Always visible, all states

---

## Responsive behaviour

- Desktop (> 900px): alignment canvas fills available width, video section below
- Tablet: same layout, canvas slightly shorter
- Mobile: functional but not primary use case. Canvas and scrubber stack vertically. Transport controls wrap to two rows if needed.

---

## State summary

| State | Upload zone | Canvas | Still export | Video section |
|-------|-------------|--------|--------------|---------------|
| Initial | Visible | Hidden | Hidden | Hidden |
| Image loaded | Collapsed | Visible | Visible | Hidden |
| Video loaded | Collapsed | Visible | Hidden | Visible |
| Frame selected | — | Active | — | Scrubber active |
| Values retrieved | — | — | — | Produce active |
| Processing | — | — | — | Progress visible |
| Complete | — | — | — | Download visible |
