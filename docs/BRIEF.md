# 360° Video Horizon Aligner — Claude Code Briefing

## What this is

A web-based tool that corrects the horizon alignment of static 360° equirectangular video footage. The user scrubs through their video to find a clean, settled frame, uses an alignment canvas (identical in behaviour to the existing PanoAlign tool) to derive yaw/pitch/roll correction values, then submits the job. FFmpeg applies those values uniformly to every frame of the entire video. The corrected MP4 is returned for download.

## What this is NOT

- A moving-camera stabiliser
- A per-frame dynamic correction tool
- A trim/edit tool
- A format converter

## Relationship to existing tools

This project shares alignment canvas logic with **PanoAlign**. The equirectangular viewer, drag-to-align interaction, and hotspot projection maths should be treated as known-good reference implementations. Do not reinvent them — reuse or port directly.

## Core constraint

The correction values derived from the user's chosen frame are applied **identically to every frame in the video**, from frame 0 to the last frame. There is no per-frame analysis, no tracking, no optical flow. Simple, predictable, deterministic.

## File structure

```
/
├── CLAUDE.md           ← this file
├── OVERVIEW.md         ← product scope and decisions
├── UI.md               ← frontend spec
├── SCRUBBER.md         ← video scrubber component spec
├── ALIGNMENT.md        ← alignment canvas spec
├── PROCESSING.md       ← FFmpeg processing pipeline
├── INFRASTRUCTURE.md   ← Docker / Coolify / API spec
├── WARNINGS.md         ← user-facing warnings and edge cases
└── QUALITY.md          ← output quality and encoding settings
```

## Tech stack

- **Frontend:** Next.js 14 (consistent with GeekyBee landing page repo)
- **Backend:** Node.js API route or lightweight Express endpoint
- **Processing:** FFmpeg via fluent-ffmpeg or direct child_process
- **Deployment:** Coolify / Docker
- **Styling:** Consistent with existing GeekyBee tools — dark theme, DM Mono, Syne

## Owner

GeekyBee Ltd — geekybee.net  
Developer: G
