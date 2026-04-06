# WARNINGS.md — User Warnings & Edge Cases

## Design principle

The tool is honest, not nannying. Warnings are shown once, clearly, at the right moment. They do not block the user. The user decides.

---

## Warning 1 — Whole-file application (shown in Stage 2, always visible)

> ℹ️ **These values apply to your entire video.**  
> Every frame — from the very first to the very last — will be corrected using the yaw, pitch and roll values shown here. If your video contains setup footage or camera movement before or after the section you want, those frames will also be corrected and may look wrong. **Trim your source file first** if you only want part of the video corrected.

**Placement:** Persistent advisory panel in Stage 2, below the controls.  
**Dismissible:** No — always visible.  
**Tone:** Informational, not alarming.

---

## Warning 2 — Reference frame is not frame 0 (shown when user selects a frame past 30 seconds)

> ⚠️ Your reference frame is at **{timecode}**. The correction will also be applied to the **{N minutes}** of footage before this point. If that earlier footage shows the camera being set up or moved, it will look incorrectly corrected in the output.

**Trigger:** User clicks "Use this frame" and `currentTime > 30`  
**Placement:** Below the "Use this frame" button, replaces the timecode display  
**Dismissible:** Yes — user can click "Got it" to collapse  
**Tone:** Specific and factual, not alarming

---

## Warning 3 — Large file (shown at upload, file > 2GB)

> ℹ️ Large file detected ({size}GB). Processing will take longer than usual — expect **{estimated minutes}** or more depending on server load. The page must remain open during processing.

**Placement:** Below the file info in Stage 1  
**Tone:** Practical heads-up, not a deterrent

Estimated time calculation (rough):
- Assume ~0.3× realtime for 1080p H.264 on a modest server
- A 30-minute 4K 360 video ≈ 20–40 minutes processing time
- Show as a range, not a precise number

---

## Warning 4 — All values are zero (shown when user clicks "Apply to video" with no correction set)

> Are you sure? All correction values are currently 0° — your video will be re-encoded but not visually changed. This will take time and produce a file identical to the original.

**Type:** Confirmation dialog, not just a toast  
**Options:** "Apply anyway" / "Go back and adjust"  
**Tone:** Genuinely checking, not condescending

---

## Warning 5 — Re-encoding quality loss (shown once in Stage 2, collapsible)

> ℹ️ Re-encoding always involves a small quality reduction compared to the original, even at high quality settings. This tool uses near-lossless settings (CRF 18) to minimise this. For best results, work from the highest quality source file available.

**Dismissible:** Yes, permanently (localStorage)  
**Tone:** Technical but honest

---

## Edge case handling

| Situation | Behaviour |
|-----------|-----------|
| User closes tab during processing | Job continues server-side. Output file held for 2 hours. No recovery UI in v1. |
| FFmpeg fails mid-job | Error state shown. Temp files cleaned up. User returned to Stage 2 with values preserved. |
| User uploads a non-360 video | No validation — tool processes it. Output will look distorted. Not our problem. |
| Video has no audio track | `-c:a copy` with no audio track is harmless — FFmpeg handles this gracefully. |
| Extremely short video (< 5 seconds) | Works fine. Thumbnail strip shows fewer thumbnails. No special handling needed. |
| User submits same jobId twice | Second request returns error. JobId is single-use. |
| Disk full on server | FFmpeg will fail. Generic error shown to user. Monitor disk space separately. |
