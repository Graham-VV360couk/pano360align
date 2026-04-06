# PROCESSING.md — FFmpeg Processing Pipeline

## What FFmpeg does

Takes the uploaded video and applies a v360 equirectangular remapping with the user's yaw/pitch/roll correction values baked in. Audio is passed through untouched. Output is a corrected MP4.

---

## Core FFmpeg command

```bash
ffmpeg \
  -i input.mp4 \
  -vf "v360=e:e:yaw={YAW}:pitch={PITCH}:roll={ROLL}:interp=lanczos" \
  -c:v libx264 \
  -crf 18 \
  -preset slow \
  -pix_fmt yuv420p \
  -c:a copy \
  -movflags +faststart \
  -metadata:s:v:0 spherical=true \
  output.mp4
```

### Parameter explanation

| Parameter | Value | Reason |
|-----------|-------|--------|
| `v360=e:e` | equirectangular → equirectangular | Input and output are both equirectangular |
| `yaw` | user value | Horizontal correction in degrees |
| `pitch` | user value | Vertical correction in degrees |
| `roll` | user value | Rotational correction in degrees |
| `interp=lanczos` | Lanczos interpolation | Best quality resampling, slower than bilinear but worth it |
| `crf 18` | Near-lossless | Quality-controlled encode. 18 is visually near-lossless for this use case |
| `preset slow` | Encoding speed | Better compression at the cost of time. Acceptable for server-side batch |
| `pix_fmt yuv420p` | Pixel format | Maximum compatibility with players and 3DVista |
| `-c:a copy` | Audio passthrough | Do not re-encode audio — preserves quality, saves time |
| `faststart` | MP4 atom order | Moves MOOV atom to front — required for web streaming / 3DVista |
| `spherical=true` | Metadata | Marks output as 360 video for players that respect this flag |

---

## Sign convention

FFmpeg's v360 filter uses the same sign convention as the alignment canvas:
- Positive yaw = rotate right
- Positive pitch = rotate up  
- Positive roll = rotate clockwise

**Verify this against the alignment canvas implementation.** If the corrected video appears to go the wrong direction, negate the values:

```javascript
// If signs need inverting:
const ffmpegYaw   = -alignmentYaw;
const ffmpegPitch = -alignmentPitch;
const ffmpegRoll  = -alignmentRoll;
```

Test with a known tilted image before assuming signs are correct.

---

## Progress reporting

FFmpeg outputs progress to stderr. Parse it to report percentage to the frontend.

```javascript
// FFmpeg stderr line format:
// frame=  420 fps= 12 q=18.0 size=   12345kB time=00:00:14.00 bitrate=1234.5kbits/s speed=0.4x

ffmpegProcess.stderr.on('data', (data) => {
  const match = data.toString().match(/time=(\d+):(\d+):(\d+\.\d+)/);
  if (match) {
    const currentSeconds = 
      parseInt(match[1]) * 3600 + 
      parseInt(match[2]) * 60 + 
      parseFloat(match[3]);
    const progress = Math.min(99, (currentSeconds / totalDuration) * 100);
    sendProgressToClient(progress);
  }
});
```

Send progress as SSE (Server-Sent Events) or via polling endpoint — SSE is preferred.

---

## Job lifecycle

```
UPLOADED  → file written to temp directory
QUEUED    → job added to queue
PROCESSING → FFmpeg running, progress reported
COMPLETE  → output file ready, download URL issued
FAILED    → error logged, user notified
EXPIRED   → output file deleted after TTL
```

---

## File handling

### Upload
- Multipart form upload to `/api/upload`
- Written to `/tmp/360aligner/{jobId}/input.{ext}`
- jobId: UUID v4

### Output
- Written to `/tmp/360aligner/{jobId}/output.mp4`
- Served via `/api/download/{jobId}`
- Filename offered to user: `{original-filename}-aligned.mp4`

### Cleanup
- Input file: deleted immediately after FFmpeg starts (saves disk space)
- Output file: deleted after **2 hours** or on download, whichever comes first
- Cron or setTimeout-based cleanup — keep it simple

---

## CRF quality setting

CRF 18 is the default (near-lossless). Expose this as an internal constant, not a user control:

```javascript
const ENCODE_CRF = 18; // 0=lossless, 18=near-lossless, 23=default, 28=low quality
```

If disk space or processing time becomes an issue in production, raise to 20–22. Do not go above 23.

---

## H.265 / HEVC input

If the input is H.265, FFmpeg handles it transparently. Output is always H.264 for maximum compatibility. If the user specifically needs H.265 output this can be added later — out of scope for v1.

---

## Audio

`-c:a copy` passes audio through without any processing. This is always correct for this use case. Do not re-encode audio under any circumstances.
