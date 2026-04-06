import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { unlink } from "fs/promises";
import { dirname } from "path";
import { mkdir } from "fs/promises";
import {
  getJob,
  updateJob,
  snapshot,
  OUTPUT_TTL_MS,
  deleteJob,
} from "@/lib/jobs";
import { rm } from "fs/promises";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const ENCODE_CRF = 18;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { jobId, yaw, pitch, roll } = body as {
    jobId?: string;
    yaw?: number;
    pitch?: number;
    roll?: number;
  };

  if (!jobId || yaw === undefined || pitch === undefined || roll === undefined) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const job = getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (job.status === "processing") {
    return NextResponse.json({ error: "Job already processing" }, { status: 409 });
  }

  await mkdir(dirname(job.outputPath), { recursive: true });

  // Build the v360 filter. Sign convention follows the alignment canvas;
  // negate here if testing reveals an inversion (see docs/PROCESSING.md).
  const vf = `v360=e:e:yaw=${yaw}:pitch=${pitch}:roll=${roll}:interp=lanczos`;
  const args = [
    "-y",
    "-i", job.inputPath,
    "-vf", vf,
    "-c:v", "libx264",
    "-crf", String(ENCODE_CRF),
    "-preset", "slow",
    "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    "-movflags", "+faststart",
    "-metadata:s:v:0", "spherical=true",
    job.outputPath,
  ];

  const proc = spawn(FFMPEG, args, { stdio: ["ignore", "pipe", "pipe"] });

  updateJob(jobId, {
    status: "processing",
    progress: 0,
    process: proc,
    error: undefined,
  });

  // Parse stderr for input duration and time= progress
  let stderrTail = "";
  proc.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stderrTail = (stderrTail + text).slice(-4000);

    if (job.duration === undefined) {
      const dm = text.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
      if (dm) {
        const d =
          parseInt(dm[1]) * 3600 + parseInt(dm[2]) * 60 + parseFloat(dm[3]);
        job.duration = d;
      }
    }
    const tm = text.match(/time=(\d+):(\d+):(\d+\.\d+)/);
    if (tm && job.duration && job.duration > 0) {
      const cur =
        parseInt(tm[1]) * 3600 + parseInt(tm[2]) * 60 + parseFloat(tm[3]);
      const pct = Math.min(99, (cur / job.duration) * 100);
      if (pct - job.progress >= 0.5) {
        updateJob(jobId, { progress: pct });
      }
    }
  });

  proc.on("error", (err) => {
    updateJob(jobId, { status: "failed", error: err.message });
  });

  proc.on("close", (code) => {
    if (code === 0) {
      updateJob(jobId, {
        status: "complete",
        progress: 100,
        completedAt: Date.now(),
      });
      // Schedule output cleanup
      const j = getJob(jobId);
      if (j) {
        j.cleanupTimer = setTimeout(async () => {
          try {
            await rm(dirname(j.outputPath), { recursive: true, force: true });
          } catch {}
          updateJob(jobId, { status: "expired" });
          deleteJob(jobId);
        }, OUTPUT_TTL_MS);
      }
    } else {
      updateJob(jobId, {
        status: "failed",
        error: `FFmpeg exited ${code}: ${stderrTail.split("\n").slice(-5).join(" ")}`,
      });
    }
  });

  // Delete input as soon as ffmpeg has it open (give it a brief head start)
  setTimeout(() => {
    unlink(job.inputPath).catch(() => {});
  }, 2000);

  return NextResponse.json(snapshot(job));
}
