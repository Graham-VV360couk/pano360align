# SCRUBBER.md — Video Scrubber Component

## Purpose

Allow the user to navigate through their uploaded video to find a frame where:
- The camera is settled and not being handled
- A visually straight reference line is visible (wall edge, pole, doorframe, horizon)
- The footage they actually want to correct begins

The user may need to scrub many minutes into a long recording — past dark setup frames, past someone adjusting the camera, past a knock. The scrubber must make this fast and visual without requiring a large video preview area.

---

## Design principle

There is no dedicated full-size video preview panel. The scrubber lives at the bottom of the page, compact. Visual feedback comes from two sources working together:

1. **Thumbnail strip** — macro overview of the whole video at a glance
2. **Hover preview** — small floating frame that follows the cursor for precise positioning

Together these give the user everything they need to find their frame without a large video element taking up page real estate.

---

## Component structure

```
┌─────────────────────────────────────────────────────────────┐
│  ▼ VIDEO                                                    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  |    |    |    |    |    |    |    |    |    |    | │   │
│  │ [▓]  [▓]  [▓]  [▓]  [▓]  [▓]  [▓]  [▓]  [▓]  [▓] │   │
│  └─────────────────────────────────────────────────────┘   │
│            ↑ hover preview appears above cursor             │
│       ┌────────────┐                                        │
│       │  240×135   │  (appears on hover, follows cursor)   │
│       │ video frame│                                        │
│       └────────────┘                                        │
│                                                             │
│  ████████████████░░░░░░░░░░░░░░░░░░░░  ← scrub bar         │
│                                                             │
│  [ ◀◀ ] [ ◀1 ] [ ▶/⏸ ] [ 1▶ ] [ ▶▶ ]     00:12:34 / 00:45:20  │
│                                                             │
│              [ USE THIS FRAME ]                             │
│          Reference frame: 00:12:34                          │
└─────────────────────────────────────────────────────────────┘
```

---

## Hidden video element

A single `<video>` element drives everything. It is **not displayed** — it exists purely as a decode source.

```html
<video id="sourceVideo" preload="metadata" muted style="display:none"></video>
```

- `preload="metadata"` — fetches duration and dimensions without downloading the full file
- Muted — audio is irrelevant for alignment
- All visual output comes from canvas draws, not the video element itself

---

## Thumbnail strip

The strip gives a macro view of the entire video — the user can see at a glance where dark sections end, where movement occurs, where the camera settles.

### Generation

- Generated client-side after upload by seeking the hidden video to N evenly-spaced points and capturing canvas snapshots
- Runs progressively in the background — does not block the UI
- Show placeholder grey tiles immediately, replace each as it generates

```javascript
async function generateThumbnails(video, count) {
  const interval = video.duration / count;
  const thumbs = [];
  for (let i = 0; i < count; i++) {
    video.currentTime = i * interval;
    await waitForSeeked(video);
    const oc = document.createElement('canvas');
    oc.width = 160; oc.height = 90; // 16:9 thumbnail
    oc.getContext('2d').drawImage(video, 0, 0, 160, 90);
    thumbs.push({ time: i * interval, src: oc.toDataURL('image/jpeg', 0.7) });
  }
  return thumbs;
}
```

### Count by duration

| Video duration | Thumbnail count |
|----------------|----------------|
| Under 5 min    | 20             |
| 5–30 min       | 30             |
| Over 30 min    | 40             |

### Behaviour

- Each thumbnail is clickable — seeks video and scrub bar to that time
- Current playhead position highlighted with cyan accent border on nearest thumbnail
- "Reference frame" marker (distinct colour — orange) shown on the thumbnail nearest the selected frame after "Use this frame" is clicked
- Strip is horizontally scrollable on small screens

---

## Hover preview

A small floating canvas — **240×135px (16:9)** — that appears above the thumbnail strip and follows the cursor horizontally as the user hovers over the strip or scrub bar.

### Behaviour

- Appears on `mousemove` over the scrubber area
- Disappears on `mouseleave`
- Positioned absolutely above the cursor, centred horizontally on it
- Stays within viewport bounds — flips to left-align near the right edge, right-align near the left edge
- Shows the frame at the time position corresponding to the cursor's horizontal position — not the current playhead position

### Implementation

```javascript
scrubberArea.addEventListener('mousemove', (e) => {
  const rect = scrubberArea.getBoundingClientRect();
  const fraction = (e.clientX - rect.left) / rect.width;
  const hoverTime = fraction * video.duration;

  // Seek hidden video to hover time
  video.currentTime = hoverTime;

  // On seeked, draw to preview canvas
  video.addEventListener('seeked', drawPreview, { once: true });

  // Position the preview above the cursor
  preview.style.left = clamp(e.clientX - 120, 0, window.innerWidth - 240) + 'px';
  preview.style.display = 'block';
});

function drawPreview() {
  previewCtx.drawImage(video, 0, 0, 240, 135);
}

scrubberArea.addEventListener('mouseleave', () => {
  preview.style.display = 'none';
  // Restore video to playhead position
  video.currentTime = currentPlayheadTime;
});
```

### Note on seek conflicts

The hover preview temporarily seeks the hidden video away from the playhead position. When the cursor leaves the scrubber area, the video is seeked back to `currentPlayheadTime`. This is seamless to the user. Do not update the scrub bar position during hover — only update it on click/drag.

### Performance note

Seeking a large video file on every `mousemove` event will be slow. Two mitigations:

1. **Throttle** the mousemove handler to fire at most every 80ms
2. **Fallback to thumbnail interpolation** — if the nearest pre-generated thumbnail is within 2 seconds of the hover position, use that image instead of seeking the video. For most hover interactions this is fast enough and indistinguishable.

```javascript
function getHoverFrame(hoverTime) {
  const nearest = thumbnails.reduce((a, b) =>
    Math.abs(b.time - hoverTime) < Math.abs(a.time - hoverTime) ? b : a
  );
  if (Math.abs(nearest.time - hoverTime) < 2) {
    // Use pre-generated thumbnail
    drawThumbnailToPreview(nearest.src);
  } else {
    // Seek video for precision
    seekVideoToTime(hoverTime);
  }
}
```

---

## Scrub bar

- Full-width range input, styled to match dark theme
- Dragging updates `currentPlayheadTime` and seeks the hidden video
- On seek complete, draws current frame to a **reference canvas** (see below)
- Updates thumbnail strip highlight position
- Displays timecode: `HH:MM:SS` (or `HH:MM:SS:FF` if FPS is detectable)

---

## Reference canvas

A small **320×180px canvas** displayed to the left of the transport controls. Shows the frame at the current playhead position — updated on scrub bar drag, play, and frame step. This is the "what am I looking at right now" display, distinct from the hover preview.

```
[ reference canvas 320×180 ]   [ ◀◀ ] [ ◀1 ] [ ▶/⏸ ] [ 1▶ ] [ ▶▶ ]   00:12:34
```

This replaces the need for a full-size video preview panel. Small, always visible, always current.

---

## Transport controls

| Button | Action |
|--------|--------|
| ◀◀ | Jump back 10 seconds |
| ◀1 | Step back 1 frame (1/fps seconds) |
| ▶/⏸ | Play / pause |
| 1▶ | Step forward 1 frame |
| ▶▶ | Jump forward 10 seconds |

- FPS detection: read from video metadata. If unavailable, assume 30fps for frame stepping.
- During playback, reference canvas updates at ~15fps (requestAnimationFrame, draw every other frame) — smooth enough without being expensive.
- Playback rate selector: 0.25× / 0.5× / 1× — allows slow scrub for precision. Small dropdown, right-aligned.

---

## "Use this frame" button

- Primary action, full-width, prominent
- On click:
  1. Pause video if playing
  2. Record `currentPlayheadTime` as the reference time
  3. Capture the reference canvas image at full video resolution (re-seek and draw at native resolution, not 320×180)
  4. Downsample to max 4096×2048 (see ALIGNMENT.md)
  5. Pass to alignment canvas above
  6. Show "Reference frame: HH:MM:SS" below the button
  7. Mark the nearest thumbnail in the strip with an orange border marker
- User can click "Use this frame" again at any time — alignment canvas reloads with the new frame and resets yaw/pitch/roll to 0

---

## Edge cases

| Situation | Handling |
|-----------|----------|
| First frames are black | User scrubs past them — thumbnail strip makes this obvious visually |
| Very long video (> 1hr) | Thumbnails generate with max count (40); warn about processing time separately |
| Video has variable frame rate | Use wall-clock time for all seeking and stepping, never frame count |
| Seek takes time on large file | Reference canvas shows previous frame until seek completes — no blank flash |
| Browser cannot decode codec | Friendly error at upload — "Your browser can't preview this file. Try re-exporting as H.264 MP4." Does not prevent upload — FFmpeg may still process it. |
| Hover preview during thumbnail generation | Use whatever thumbnails are available; grey tile if none generated yet for that position |
