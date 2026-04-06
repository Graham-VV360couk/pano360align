# QUALITY.md — Output Quality & Encoding Settings

## Philosophy

Every re-encode costs a generation of quality. The tool uses near-lossless settings to make that loss as small as possible. The user is responsible for starting from the best available source.

---

## Video encoding settings

| Setting | Value | Notes |
|---------|-------|-------|
| Codec | H.264 (libx264) | Maximum compatibility |
| CRF | 18 | Near-lossless. Visually indistinguishable from source in almost all cases |
| Preset | slow | Better compression efficiency. Acceptable for server-side processing |
| Pixel format | yuv420p | Required for broad player compatibility including 3DVista and mobile |
| Interpolation | Lanczos | Best quality for the v360 remap. Slower than bilinear but worth it |

## Audio

| Setting | Value |
|---------|-------|
| Codec | Copy (passthrough) |
| Quality loss | Zero |
| Processing time added | Zero |

Never re-encode audio. `-c:a copy` always.

---

## CRF reference

| CRF | Quality | Typical size vs source |
|-----|---------|----------------------|
| 0 | Mathematically lossless | 5–10× larger |
| 18 | Near-lossless ✅ | ~1.2–1.5× |
| 23 | FFmpeg default | ~0.7–0.9× |
| 28 | Acceptable web quality | ~0.4–0.6× |

CRF 18 will sometimes produce a file *larger* than the source if the source was heavily compressed (e.g. a camera output at high bitrate with complex compression). This is normal and correct — the re-encode at CRF 18 is preserving more data than the original lossy compression retained.

---

## Interpolation quality

The v360 filter must resample every pixel as part of the rotation. The interpolation method determines how it handles sub-pixel positions:

| Method | Quality | Speed |
|--------|---------|-------|
| near | Lowest (nearest neighbour) | Fastest |
| bilinear | Acceptable | Fast |
| lanczos | Best | Slow |
| spline16 | Good | Medium |

Use `lanczos` for all output. If processing time becomes a serious constraint on large files, `spline16` is a reasonable fallback. Never use `near` or `bilinear` for final output.

---

## 360 metadata

The output MP4 should be marked as spherical video so downstream tools (3DVista, YouTube, Facebook 360, Premiere) recognise it without manual configuration.

FFmpeg approach — add spherical XMP metadata:

```bash
-metadata:s:v:0 spherical=true
```

For full compliance with the Spherical Video RFC, consider using the `spatial-media` Python tool as a post-processing step:

```bash
python spatial-media-metadata-injector.py -i output.mp4 -o output-spatial.mp4
```

This is optional for 3DVista (which reads the file correctly regardless) but recommended if the output will be uploaded to YouTube or Facebook 360.

---

## Output resolution

The output resolution is identical to the input resolution. The v360 filter does not change dimensions — it remaps pixel positions within the same frame size.

Do not add scaling to the FFmpeg command. If the user wants a different resolution, that is a separate workflow step in Premiere or Resolve.

---

## Faststart

Always include `-movflags +faststart`. This moves the MOOV atom to the beginning of the MP4 file, which is required for:
- Progressive web streaming (3DVista hosting)
- Correct playback before full download
- Some 360 players that read metadata before buffering

Without faststart, the file works locally but may fail or stutter in web-hosted virtual tours.

---

## What the user should bring to this tool

For best results, the user should start from:
- The highest bitrate MP4 their camera produces
- Or a ProRes / DNxHD intermediate if they've already done colour work
- **Not** a previously compressed web-delivery copy

The tool cannot recover quality that wasn't in the source. CRF 18 preserves what's there — it doesn't add what isn't.
