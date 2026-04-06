# OVERVIEW.md — Product Scope & Key Decisions

## Problem being solved

360° cameras mounted on tripods often produce footage where the horizon is tilted — the camera wasn't perfectly level when placed. This is common in confined spaces (vehicles, cockpits, tight interiors) where it's difficult or impossible to check the camera position before recording. The footage is otherwise good: static, sharp, usable — but visually wrong.

The correction is simple mathematics: derive the offset angle, apply it. The challenge for the user is that existing tools (FFmpeg CLI, Premiere, etc.) require technical knowledge. This tool makes it point-and-click.

## In scope

- Static tripod-mounted 360° equirectangular video (MP4, MOV)
- Single correction value set (yaw / pitch / roll) applied uniformly to the whole file
- User-selected reference frame anywhere in the video
- Server-side FFmpeg processing
- Download of corrected MP4

## Out of scope

- Moving / handheld camera footage
- Per-frame dynamic correction
- Gyroscopic stabilisation
- Optical flow / object tracking
- Audio processing (audio must be passed through unchanged)
- Trim / cut / edit functionality
- Non-equirectangular formats (cubemap, fisheye etc.)
- Proprietary camera formats (Insta360 .insv, GoPro .360) — user must export to MP4 first

## Key product decisions (already made, do not revisit)

| Decision | Rationale |
|----------|-----------|
| Correction applied to entire file | Simpler, predictable, user's responsibility to trim first |
| Reference frame chosen by user via scrubber | First frame is often black / setup footage |
| No automatic horizon detection | Unreliable on 360 footage; user knows their scene |
| Server-side FFmpeg, not browser-based | Browser canvas processing of video is too slow and memory-limited for real-world file sizes |
| Single output file | No split / multi-segment output |
| Audio passed through unchanged | `-c:a copy` in FFmpeg — no re-encode of audio |

## User responsibility

The tool does what it's told. If the user:
- Has not trimmed setup footage from the start — the output will contain uncorrected-looking frames at the start (mathematically corrected, just at the wrong angle for that section)
- Selects a frame where the camera was being moved — the correction will be wrong
- Uploads footage from a moving camera — the result will look wrong throughout

The tool warns about these scenarios but does not prevent them. The user decides.

## Supported input formats

| Format | Container | Notes |
|--------|-----------|-------|
| H.264 | MP4 | Primary target |
| H.265/HEVC | MP4 / MOV | Supported if FFmpeg build includes it |
| H.264 | MOV | Common from older 360 cameras |

Maximum recommended input file size: 8GB. Larger files will work but job queue times will be significant — user should be warned.
