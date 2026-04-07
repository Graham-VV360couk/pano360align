"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { AlignmentValues } from "@/app/page";
import { addClientJob } from "@/lib/clientJobs";
import { setLastAlignment } from "@/lib/clientAlignment";

interface VideoSectionProps {
  file: File;
  alignment: AlignmentValues;
  fov: number;
  onFrameSelected: (dataURL: string) => void;
  onJobQueued: () => void;
  onUploadingChange?: (uploading: boolean) => void;
}

interface Thumb {
  time: number;
  src: string;
}

const THUMB_W = 160;
const THUMB_H = 90;
const HOVER_W = 240;
const HOVER_H = 135;
const REF_W = 320;
const REF_H = 180;
const MAX_EXPORT_W = 4096;

function fmtTime(t: number): string {
  if (!isFinite(t) || t < 0) t = 0;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function thumbCount(duration: number): number {
  if (duration < 300) return 20;
  if (duration < 1800) return 30;
  return 40;
}

function waitForSeeked(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    const handler = () => {
      video.removeEventListener("seeked", handler);
      resolve();
    };
    video.addEventListener("seeked", handler);
  });
}

export default function VideoSection({
  file,
  alignment,
  fov,
  onFrameSelected,
  onJobQueued,
  onUploadingChange,
}: VideoSectionProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const refCanvasRef = useRef<HTMLCanvasElement>(null);
  const hoverCanvasRef = useRef<HTMLCanvasElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const scrubberAreaRef = useRef<HTMLDivElement>(null);
  const playRafRef = useRef<number | null>(null);
  const hoverThrottleRef = useRef(0);
  const seekingForHoverRef = useRef(false);
  const playheadTimeRef = useRef(0);
  const fpsRef = useRef(30);

  const [duration, setDuration] = useState(0);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [thumbs, setThumbs] = useState<Thumb[]>([]);
  const [refTime, setRefTime] = useState<number | null>(null);
  const [hoverState, setHoverState] = useState<{
    visible: boolean;
    left: number;
    time: number;
  }>({ visible: false, left: 0, time: 0 });
  const [playbackRate, setPlaybackRate] = useState(1);
  const [decodeError, setDecodeError] = useState(false);
  const [frameLocked, setFrameLocked] = useState(false);

  // Production pipeline state
  const [lockedAlignment, setLockedAlignment] = useState<AlignmentValues | null>(
    null
  );
  const [trimToReference, setTrimToReference] = useState(false);
  // Per-job quality toggles. Persisted to localStorage so they're sticky
  // across sessions but default OFF for new users.
  const [highQuality, setHighQuality] = useState(false);
  const [highQualityInterp, setHighQualityInterp] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined") {
      setHighQuality(localStorage.getItem("pano360.highQuality") === "1");
      setHighQualityInterp(
        localStorage.getItem("pano360.highQualityInterp") === "1"
      );
    }
  }, []);
  const toggleHighQuality = (next: boolean) => {
    setHighQuality(next);
    try {
      localStorage.setItem("pano360.highQuality", next ? "1" : "0");
    } catch {}
  };
  const toggleHighQualityInterp = (next: boolean) => {
    setHighQualityInterp(next);
    try {
      localStorage.setItem("pano360.highQualityInterp", next ? "1" : "0");
    } catch {}
  };
  type Phase = "idle" | "uploading" | "processing" | "complete" | "failed";
  const [phase, setPhase] = useState<Phase>("idle");
  const [jobId, setJobId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [jobError, setJobError] = useState<string | null>(null);
  const uploadXhrRef = useRef<XMLHttpRequest | null>(null);

  // Late reference frame warning (Warning 2)
  const [lateRefDismissed, setLateRefDismissed] = useState(false);
  // Re-encoding quality notice (Warning 5) — dismissible permanently
  const [reencodeDismissed, setReencodeDismissed] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined") {
      setReencodeDismissed(
        localStorage.getItem("pano360.reencodeDismissed") === "1"
      );
    }
  }, []);
  const dismissReencode = () => {
    setReencodeDismissed(true);
    try {
      localStorage.setItem("pano360.reencodeDismissed", "1");
    } catch {}
  };

  // Notify the parent when we enter or leave the "uploading" phase so it
  // can lock the upload-zone "Start again" button. Without this the user
  // could navigate away mid-upload and orphan a job in pending-upload.
  useEffect(() => {
    onUploadingChange?.(phase === "uploading");
  }, [phase, onUploadingChange]);

  // If the user changes alignment after locking, invalidate the lock
  useEffect(() => {
    if (
      lockedAlignment &&
      (lockedAlignment.yaw !== alignment.yaw ||
        lockedAlignment.pitch !== alignment.pitch ||
        lockedAlignment.roll !== alignment.roll)
    ) {
      setLockedAlignment(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alignment.yaw, alignment.pitch, alignment.roll]);

  // Drive the video element from the file prop
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const video = videoRef.current;
    if (!video) return;
    video.src = url;
    video.load();
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  // Draw current video frame to the reference canvas
  const drawRef = useCallback(() => {
    const video = videoRef.current;
    const canvas = refCanvasRef.current;
    if (!video || !canvas) return;
    if (video.readyState < 2) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, REF_W, REF_H);
  }, []);

  // Metadata: set duration, kick off thumbnail generation
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onMeta = async () => {
      setDuration(video.duration);
      setDecodeError(false);
      // Try to detect FPS — most browsers don't expose it; fall back to 30.
      // (Some platforms expose video.getVideoPlaybackQuality, but no fps.)
      fpsRef.current = 30;
      // Generate thumbnails sequentially in the background
      const count = thumbCount(video.duration);
      const interval = video.duration / count;
      const list: Thumb[] = [];
      const oc = document.createElement("canvas");
      oc.width = THUMB_W;
      oc.height = THUMB_H;
      const octx = oc.getContext("2d")!;
      for (let i = 0; i < count; i++) {
        const t = i * interval + interval / 2;
        try {
          video.currentTime = t;
          await waitForSeeked(video);
          octx.drawImage(video, 0, 0, THUMB_W, THUMB_H);
          list.push({ time: t, src: oc.toDataURL("image/jpeg", 0.7) });
          setThumbs([...list]);
        } catch {
          break;
        }
      }
      // Restore to start
      video.currentTime = 0;
      await waitForSeeked(video);
      playheadTimeRef.current = 0;
      setPlayhead(0);
      drawRef();
    };
    const onError = () => setDecodeError(true);

    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("error", onError);
    return () => {
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("error", onError);
    };
  }, [file, drawRef]);

  // Playback loop — updates playhead and reference canvas during play
  useEffect(() => {
    if (!playing) {
      if (playRafRef.current != null) cancelAnimationFrame(playRafRef.current);
      playRafRef.current = null;
      return;
    }
    let frame = 0;
    const loop = () => {
      const video = videoRef.current;
      if (!video) return;
      playheadTimeRef.current = video.currentTime;
      setPlayhead(video.currentTime);
      // Draw every other rAF tick (~30fps → ~15fps)
      if (frame++ % 2 === 0) drawRef();
      if (video.paused || video.ended) {
        setPlaying(false);
        return;
      }
      playRafRef.current = requestAnimationFrame(loop);
    };
    playRafRef.current = requestAnimationFrame(loop);
    return () => {
      if (playRafRef.current != null) cancelAnimationFrame(playRafRef.current);
    };
  }, [playing, drawRef]);

  // Apply playback rate
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  // Seek to a time and draw reference canvas (only when not playing)
  const seekTo = useCallback(
    async (t: number) => {
      const video = videoRef.current;
      if (!video) return;
      const clamped = Math.max(0, Math.min(duration || 0, t));
      playheadTimeRef.current = clamped;
      setPlayhead(clamped);
      video.currentTime = clamped;
      await waitForSeeked(video);
      drawRef();
    },
    [duration, drawRef]
  );

  // Scrub bar input
  const onScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (playing) {
      const video = videoRef.current;
      if (video) video.pause();
      setPlaying(false);
    }
    seekTo(parseFloat(e.target.value));
  };

  // Hover preview
  const onHoverMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const area = scrubberAreaRef.current;
    if (!area || duration <= 0) return;
    const rect = area.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const hoverTime = fraction * duration;

    // Position preview, centred on cursor, clamped to viewport
    const left = Math.max(
      0,
      Math.min(window.innerWidth - HOVER_W, e.clientX - HOVER_W / 2)
    );
    setHoverState({ visible: true, left, time: hoverTime });

    // Throttle to 80ms
    const now = performance.now();
    if (now - hoverThrottleRef.current < 80) return;
    hoverThrottleRef.current = now;

    const hoverCanvas = hoverCanvasRef.current;
    if (!hoverCanvas) return;
    const hctx = hoverCanvas.getContext("2d");
    if (!hctx) return;

    // Try nearest thumbnail within 2s first
    if (thumbs.length > 0) {
      let nearest = thumbs[0];
      for (const tb of thumbs) {
        if (Math.abs(tb.time - hoverTime) < Math.abs(nearest.time - hoverTime)) {
          nearest = tb;
        }
      }
      if (Math.abs(nearest.time - hoverTime) < 2) {
        const im = new Image();
        im.onload = () => hctx.drawImage(im, 0, 0, HOVER_W, HOVER_H);
        im.src = nearest.src;
        return;
      }
    }

    // Fallback: seek the hidden video for an exact preview
    const video = videoRef.current;
    if (!video || playing || seekingForHoverRef.current) return;
    seekingForHoverRef.current = true;
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      hctx.drawImage(video, 0, 0, HOVER_W, HOVER_H);
      seekingForHoverRef.current = false;
    };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = hoverTime;
  };

  const onHoverLeave = () => {
    setHoverState((s) => ({ ...s, visible: false }));
    // Restore the hidden video to playhead position
    const video = videoRef.current;
    if (video && !playing) {
      video.currentTime = playheadTimeRef.current;
    }
  };

  // Transport
  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
  };
  const stepFrame = (dir: 1 | -1) => {
    if (playing) {
      videoRef.current?.pause();
      setPlaying(false);
    }
    seekTo(playheadTimeRef.current + dir / fpsRef.current);
  };
  const jump = (delta: number) => {
    if (playing) {
      videoRef.current?.pause();
      setPlaying(false);
    }
    seekTo(playheadTimeRef.current + delta);
  };

  // "Use this frame": capture current playhead at native resolution,
  // downsample to <= 4096 wide, hand off via dataURL.
  const useThisFrame = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      video.pause();
      setPlaying(false);
    }
    // Make sure we're parked exactly on the playhead
    await seekTo(playheadTimeRef.current);
    const srcW = video.videoWidth;
    const srcH = video.videoHeight;
    if (!srcW || !srcH) return;
    const scale = srcW > MAX_EXPORT_W ? MAX_EXPORT_W / srcW : 1;
    const w = Math.round(srcW * scale);
    const h = Math.round(srcH * scale);
    const oc = document.createElement("canvas");
    oc.width = w;
    oc.height = h;
    oc.getContext("2d")!.drawImage(video, 0, 0, w, h);
    const dataURL = oc.toDataURL("image/jpeg", 0.92);
    setRefTime(playheadTimeRef.current);
    setLateRefDismissed(false);
    setFrameLocked(true);
    onFrameSelected(dataURL);
  };

  // ── Production pipeline ────────────────────────────────────
  const retrieveValues = () => {
    setLockedAlignment({ ...alignment });
  };

  const produce = async () => {
    if (!lockedAlignment) return;
    if (phase === "uploading" || phase === "processing") return;

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
      //    The server creates the job in "pending-upload" state.
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
      setJobId(newJobId);

      // 2. PUT the raw file directly to S3 — bypasses our app server's
      //    proxy entirely so the 90s upload timeout is no longer a factor.
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        uploadXhrRef.current = xhr;
        xhr.open("PUT", putUrl);
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setUploadProgress((e.loaded / e.total) * 100);
          }
        };
        xhr.onload = () => {
          uploadXhrRef.current = null;
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else
            reject(
              new Error(`S3 upload failed: ${xhr.status} ${xhr.responseText}`)
            );
        };
        xhr.onerror = () => {
          uploadXhrRef.current = null;
          reject(new Error("S3 upload network error"));
        };
        xhr.onabort = () => {
          uploadXhrRef.current = null;
          reject(new Error("Upload cancelled"));
        };
        xhr.send(file);
      });
      setUploadProgress(100);

      // 3. Tell the server the upload is done — it will mark the job as
      //    queued and the worker will pick it up.
      const completeRes = await fetch("/api/upload-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: newJobId }),
      });
      if (!completeRes.ok) {
        throw new Error(
          `upload-complete failed: ${completeRes.status} ${await completeRes.text()}`
        );
      }

      // Persist to localStorage so JobList picks it up
      addClientJob({
        id: newJobId,
        filename: file.name,
        submittedAt: Date.now(),
      });
      // Remember these values for the next video — same camera setup
      // means the user can one-click "Apply last" instead of re-aligning.
      setLastAlignment({ ...lockedAlignment, fov });
      // Notify same-tab listeners (JobList watches this)
      window.dispatchEvent(new Event("pano360.jobs.changed"));

      // Reset everything so the user can immediately drop another file.
      // The JobList component handles all subsequent status reporting.
      setPhase("idle");
      setJobId(null);
      setUploadProgress(0);
      onJobQueued();
    } catch (err) {
      setPhase("failed");
      setJobError((err as Error).message);
    }
  };

  const cancelJob = async () => {
    // Abort an in-flight upload if we're still in that phase
    if (uploadXhrRef.current) {
      try {
        uploadXhrRef.current.abort();
      } catch {}
      uploadXhrRef.current = null;
    }
    if (jobId) {
      try {
        await fetch(`/api/job/${jobId}`, { method: "DELETE" });
      } catch {}
    }
    setPhase("idle");
    setUploadProgress(0);
    setJobId(null);
  };

  // Highlight nearest thumbnail to playhead and ref marker
  const nearestThumbIndex = (t: number) => {
    if (thumbs.length === 0) return -1;
    let idx = 0;
    let best = Math.abs(thumbs[0].time - t);
    for (let i = 1; i < thumbs.length; i++) {
      const d = Math.abs(thumbs[i].time - t);
      if (d < best) {
        best = d;
        idx = i;
      }
    }
    return idx;
  };
  const playheadThumb = nearestThumbIndex(playhead);
  const refThumb = refTime != null ? nearestThumbIndex(refTime) : -1;

  return (
    <section className="border border-border-subtle rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border-subtle flex items-center justify-between">
        <h2 className="font-heading text-sm font-medium">VIDEO</h2>
        <button
          onClick={() => {
            if (
              window.confirm(
                "Start over with a different file? This will reload the page and discard any in-progress alignment (queued jobs are unaffected)."
              )
            ) {
              window.location.reload();
            }
          }}
          disabled={phase === "uploading"}
          className="font-mono text-xs text-text-muted enabled:hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-text-muted"
          title={
            phase === "uploading"
              ? "Wait until the current upload finishes"
              : "Reload the page and pick a new file"
          }
        >
          ↻ Start over
        </button>
      </div>

      {/* Hidden decode source */}
      <video ref={videoRef} preload="metadata" muted playsInline className="hidden" />

      <div className="p-4 space-y-4">
        {decodeError && (
          <div className="rounded-lg bg-red-500/5 border border-red-500/20 px-4 py-3">
            <p className="font-mono text-xs text-red-200/80">
              Your browser can&apos;t preview this file. FFmpeg may still process it server-side.
            </p>
          </div>
        )}

        {/* Scrubber area: thumbnail strip + scrub bar share hover-preview parent */}
        <div
          ref={scrubberAreaRef}
          className="relative"
          onMouseMove={onHoverMove}
          onMouseLeave={onHoverLeave}
        >
          {/* Thumbnail strip */}
          <div
            ref={stripRef}
            className="flex gap-1 h-[72px] overflow-x-auto rounded bg-black/30 p-1"
          >
            {thumbs.length === 0 && duration > 0 &&
              Array.from({ length: thumbCount(duration) }).map((_, i) => (
                <div
                  key={i}
                  className="flex-shrink-0 w-[110px] h-full bg-white/5 rounded-sm"
                />
              ))}
            {thumbs.map((tb, i) => (
              <button
                key={i}
                onClick={() => seekTo(tb.time)}
                className={`flex-shrink-0 w-[110px] h-full rounded-sm overflow-hidden border-2 transition-colors ${
                  i === refThumb
                    ? "border-orange-400"
                    : i === playheadThumb
                    ? "border-accent"
                    : "border-transparent"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={tb.src} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>

          {/* Scrub bar */}
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.01}
            value={playhead}
            onChange={onScrub}
            className="w-full mt-3"
            disabled={!duration}
          />

          {/* Hover preview */}
          {hoverState.visible && (
            <div
              className="fixed pointer-events-none z-50 rounded border border-accent/40 bg-black shadow-lg"
              style={{
                left: hoverState.left,
                top:
                  (scrubberAreaRef.current?.getBoundingClientRect().top ?? 0) -
                  HOVER_H -
                  12,
                width: HOVER_W,
                height: HOVER_H + 18,
              }}
            >
              <canvas
                ref={hoverCanvasRef}
                width={HOVER_W}
                height={HOVER_H}
                className="block"
              />
              <div className="text-center font-mono text-[10px] text-text-muted py-0.5">
                {fmtTime(hoverState.time)}
              </div>
            </div>
          )}
        </div>

        {/* Reference canvas + transport */}
        <div className="flex items-center gap-4 flex-wrap">
          <canvas
            ref={refCanvasRef}
            width={REF_W}
            height={REF_H}
            className="bg-black/40 rounded"
            style={{ width: REF_W, height: REF_H }}
          />
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 font-mono text-xs">
              <button
                onClick={() => jump(-10)}
                className="px-2 py-1 border border-border-subtle rounded hover:border-accent/30"
                title="Back 10s"
              >
                ◀◀
              </button>
              <button
                onClick={() => stepFrame(-1)}
                className="px-2 py-1 border border-border-subtle rounded hover:border-accent/30"
                title="Step back 1 frame"
              >
                ◀1
              </button>
              <button
                onClick={togglePlay}
                className="px-3 py-1 border border-accent/40 text-accent rounded hover:bg-accent/10"
              >
                {playing ? "❚❚" : "▶"}
              </button>
              <button
                onClick={() => stepFrame(1)}
                className="px-2 py-1 border border-border-subtle rounded hover:border-accent/30"
                title="Step forward 1 frame"
              >
                1▶
              </button>
              <button
                onClick={() => jump(10)}
                className="px-2 py-1 border border-border-subtle rounded hover:border-accent/30"
                title="Forward 10s"
              >
                ▶▶
              </button>
              <select
                value={playbackRate}
                onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
                className="ml-2 bg-black/40 border border-border-subtle rounded px-1 py-1 text-xs"
              >
                <option value={0.25}>0.25×</option>
                <option value={0.5}>0.5×</option>
                <option value={1}>1×</option>
              </select>
            </div>
            <span className="font-mono text-xs text-text-muted">
              {fmtTime(playhead)} / {fmtTime(duration)}
            </span>
            {refTime != null && (
              <span className="font-mono text-[11px] text-orange-300">
                Reference frame: {fmtTime(refTime)}
              </span>
            )}
          </div>
        </div>

        {/* Use this frame */}
        <button
          onClick={useThisFrame}
          disabled={!duration || frameLocked}
          className={`w-full py-3 rounded-lg border font-heading text-sm font-medium transition-colors disabled:cursor-not-allowed ${
            frameLocked
              ? "bg-accent/5 border-accent/40 text-accent disabled:opacity-100"
              : "bg-accent/10 border-accent/30 text-accent hover:bg-accent/20 disabled:opacity-30"
          }`}
        >
          {frameLocked ? "USE THIS FRAME ✓" : "USE THIS FRAME"}
        </button>

        {/* Warning 2 — late reference frame */}
        {refTime != null && refTime > 30 && !lateRefDismissed && (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-4 py-3 space-y-2">
            <p className="font-mono text-xs text-yellow-200/90 leading-relaxed">
              ⚠ Reference frame is at <strong>{fmtTime(refTime)}</strong>. The
              correction will also be applied to the {fmtTime(refTime)} of footage
              before this point. If that earlier footage shows the camera being set
              up or moved, it will look incorrectly corrected in the output.
            </p>
            <button
              onClick={() => setLateRefDismissed(true)}
              className="font-mono text-xs text-yellow-200/70 hover:text-yellow-200"
            >
              Got it
            </button>
          </div>
        )}

        {/* Warning 5 — re-encoding quality (dismissible, persistent) */}
        {!reencodeDismissed && (
          <div className="rounded-lg border border-border-subtle bg-white/[0.02] px-4 py-3 space-y-2">
            <p className="font-mono text-[11px] text-text-muted leading-relaxed">
              ℹ Re-encoding always involves a small quality reduction compared to
              the original, even at high quality settings. This tool uses
              near-lossless settings (CRF 18) to minimise this. For best results,
              work from the highest quality source file available.
            </p>
            <button
              onClick={dismissReencode}
              className="font-mono text-[11px] text-text-muted hover:text-foreground"
            >
              Don&apos;t show again
            </button>
          </div>
        )}

        {/* Advisory */}
        <div className="rounded-lg bg-yellow-500/5 border border-yellow-500/20 px-4 py-3">
          <p className="font-mono text-xs text-yellow-200/70 leading-relaxed">
            These values will be applied to every frame of your video — from the
            very first to the very last. If you only want part of the video
            corrected, trim your source file first or use the &ldquo;Trim to
            start at reference frame&rdquo; option below.
          </p>
        </div>

        {/* Per-job options */}
        <div className="space-y-2 border border-border-subtle/40 rounded-lg px-4 py-3">
          <label className="flex items-center gap-3 font-mono text-xs text-text-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={trimToReference}
              onChange={(e) => setTrimToReference(e.target.checked)}
              disabled={refTime == null || refTime === 0}
              className="accent-accent"
            />
            <span>
              Trim output to start at reference frame
              {refTime != null && refTime > 0 && (
                <span className="ml-2 text-accent">({fmtTime(refTime)})</span>
              )}
            </span>
          </label>

          <label
            className="flex items-center gap-3 font-mono text-xs text-text-muted cursor-pointer select-none"
            title="Encode at CRF 12 instead of 18. Bigger file (~30%), slightly slower encode. Use this when the corrected video will be re-edited in Premiere — preserves more headroom for grading."
          >
            <input
              type="checkbox"
              checked={highQuality}
              onChange={(e) => toggleHighQuality(e.target.checked)}
              className="accent-accent"
            />
            <span>
              Higher quality master <span className="text-text-muted/60">(CRF 12 — for further editing in Premiere)</span>
            </span>
          </label>

          <label
            className="flex items-center gap-3 font-mono text-xs text-text-muted cursor-pointer select-none"
            title="Use the spline16 v360 interpolation kernel instead of lanczos. Slightly sharper rotation result. Marginal cost in time and file size."
          >
            <input
              type="checkbox"
              checked={highQualityInterp}
              onChange={(e) => toggleHighQualityInterp(e.target.checked)}
              className="accent-accent"
            />
            <span>
              Premium interpolation <span className="text-text-muted/60">(spline16 — slightly sharper rotation)</span>
            </span>
          </label>
        </div>

        {/* Retrieve values */}
        <div className="flex gap-3">
          <button
            onClick={retrieveValues}
            disabled={
              !frameLocked ||
              lockedAlignment !== null ||
              phase === "uploading" ||
              phase === "processing"
            }
            className={`flex-1 py-3 rounded-lg border font-heading text-sm font-medium transition-colors disabled:cursor-not-allowed ${
              lockedAlignment
                ? "border-accent/40 text-accent bg-accent/5 disabled:opacity-100"
                : "border-border-subtle hover:border-accent/30 disabled:opacity-30"
            }`}
            title={`yaw ${alignment.yaw.toFixed(1)} pitch ${alignment.pitch.toFixed(1)} roll ${alignment.roll.toFixed(1)}`}
          >
            {lockedAlignment ? "VALUES LOCKED ✓" : "Retrieve Alignment Values"}
          </button>
          <button
            onClick={produce}
            disabled={
              !lockedAlignment ||
              phase === "uploading" ||
              phase === "processing"
            }
            className="flex-1 py-3 rounded-lg bg-accent/10 border border-accent/30 text-accent font-heading text-sm font-medium disabled:opacity-30 disabled:cursor-not-allowed hover:bg-accent/20 transition-colors"
          >
            Produce
          </button>
        </div>

        {lockedAlignment && (
          <div className="font-mono text-[11px] text-text-muted">
            Locked → YAW {lockedAlignment.yaw.toFixed(1)}° &nbsp; PITCH{" "}
            {lockedAlignment.pitch.toFixed(1)}° &nbsp; ROLL{" "}
            {lockedAlignment.roll.toFixed(1)}°
          </div>
        )}

        {/* Job phase UI */}
        {phase === "uploading" && (
          <div className="rounded-lg border border-accent/20 bg-accent/5 px-4 py-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="font-mono text-xs text-accent">
                Uploading… {uploadProgress.toFixed(1)}%
              </p>
              <button
                onClick={cancelJob}
                className="font-mono text-xs text-text-muted hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
            <div className="h-1.5 rounded-full bg-black/40 overflow-hidden">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <p className="font-mono text-[10px] text-text-muted leading-relaxed">
              Please don&apos;t navigate away or refresh the page. The upload is
              streaming directly to storage — leaving now will orphan this
              job. Once it reaches 100% you&apos;ll be returned to the upload
              zone automatically and can drop the next file.
            </p>
          </div>
        )}

        {phase === "failed" && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 space-y-2">
            <p className="font-mono text-xs text-red-300">
              Failed: {jobError || "Unknown error"}
            </p>
            <button
              onClick={() => {
                setPhase("idle");
                setJobError(null);
                setJobId(null);
              }}
              className="font-mono text-xs text-text-muted hover:text-foreground transition-colors"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
