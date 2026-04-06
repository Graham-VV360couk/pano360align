import { spawn, ChildProcess } from "child_process";
import { mkdir, rm } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import {
  jobKey,
  putJson,
  getJson,
  deleteObject,
  deletePrefix,
  headExists,
  downloadToFile,
  uploadFromFile,
  listJobIds,
  presignPut,
} from "./s3";

export const TEMP_DIR = process.env.TEMP_DIR || "/tmp/360aligner";
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const ENCODE_CRF = 18;
const PENDING_UPLOAD_TIMEOUT_MS = 30 * 60 * 1000; // 30 min

export type JobStatus =
  | "pending-upload"
  | "queued"
  | "downloading"
  | "processing"
  | "uploading"
  | "complete"
  | "failed";

export interface AlignmentValues {
  yaw: number;
  pitch: number;
  roll: number;
}

export interface Job {
  id: string;
  filename: string;
  ext: string;
  status: JobStatus;
  progress: number;
  alignment: AlignmentValues;
  trimStart: number;
  size: number;
  createdAt: number;
  completedAt: number | null;
  error: string | null;
}

export interface JobSnapshot extends Job {
  /** Position in the queue, 1-indexed; 0 if currently processing or not queued */
  queuePosition: number;
}

// In-memory cache rebuilt from S3 on boot. Persisted on globalThis to survive Next.js dev hot reloads.
const g = globalThis as unknown as {
  __pano360Jobs?: Map<string, Job>;
  __pano360Procs?: Map<string, ChildProcess>;
  __pano360Queue?: string[];
  __pano360CurrentId?: string | null;
  __pano360WorkerRunning?: boolean;
  __pano360BootDone?: boolean;
};
if (!g.__pano360Jobs) g.__pano360Jobs = new Map();
if (!g.__pano360Procs) g.__pano360Procs = new Map();
if (!g.__pano360Queue) g.__pano360Queue = [];
if (g.__pano360CurrentId === undefined) g.__pano360CurrentId = null;
if (g.__pano360WorkerRunning === undefined) g.__pano360WorkerRunning = false;
if (g.__pano360BootDone === undefined) g.__pano360BootDone = false;

const jobs = g.__pano360Jobs;
const procs = g.__pano360Procs;

function localDir(id: string) {
  return join(TEMP_DIR, id);
}

function snapshot(job: Job): JobSnapshot {
  const idx = g.__pano360Queue!.indexOf(job.id);
  return { ...job, queuePosition: idx >= 0 ? idx + 1 : 0 };
}

async function persist(job: Job): Promise<void> {
  jobs.set(job.id, job);
  try {
    await putJson(jobKey(job.id, "job"), job);
  } catch (err) {
    console.error(`Failed to persist job ${job.id}:`, err);
  }
}

export async function createJobForUpload(
  filename: string,
  alignment: AlignmentValues,
  trimStart: number
): Promise<{ jobId: string; putUrl: string; key: string }> {
  await ensureBoot();
  const id = randomUUID();
  const ext = (filename.split(".").pop() || "mp4").toLowerCase();
  const job: Job = {
    id,
    filename,
    ext,
    status: "pending-upload",
    progress: 0,
    alignment,
    trimStart,
    size: 0,
    createdAt: Date.now(),
    completedAt: null,
    error: null,
  };
  await persist(job);
  const key = jobKey(id, "input", ext);
  const putUrl = await presignPut(key, "application/octet-stream");
  return { jobId: id, putUrl, key };
}

export async function markUploadComplete(id: string): Promise<JobSnapshot | null> {
  await ensureBoot();
  const job = jobs.get(id);
  if (!job) return null;
  if (job.status !== "pending-upload") return snapshot(job);
  job.status = "queued";
  await persist(job);
  enqueue(id);
  startWorker();
  return snapshot(job);
}

export async function getJobSnapshot(id: string): Promise<JobSnapshot | null> {
  await ensureBoot();
  const job = jobs.get(id);
  return job ? snapshot(job) : null;
}

export async function listJobSnapshots(ids: string[]): Promise<JobSnapshot[]> {
  await ensureBoot();
  const out: JobSnapshot[] = [];
  for (const id of ids) {
    const job = jobs.get(id);
    if (job) out.push(snapshot(job));
  }
  return out;
}

export async function deleteJobFully(id: string): Promise<void> {
  await ensureBoot();
  const proc = procs.get(id);
  if (proc && !proc.killed) {
    try { proc.kill("SIGKILL"); } catch {}
  }
  procs.delete(id);
  const idx = g.__pano360Queue!.indexOf(id);
  if (idx >= 0) g.__pano360Queue!.splice(idx, 1);
  try { await deletePrefix(`jobs/${id}/`); } catch (err) { console.error(err); }
  try { await rm(localDir(id), { recursive: true, force: true }); } catch {}
  jobs.delete(id);
  if (g.__pano360CurrentId === id) g.__pano360CurrentId = null;
}

export async function retryJob(id: string): Promise<JobSnapshot | null> {
  await ensureBoot();
  const job = jobs.get(id);
  if (!job) return null;
  if (job.status !== "failed") return snapshot(job);
  const inputKey = jobKey(id, "input", job.ext);
  const exists = await headExists(inputKey);
  if (!exists) {
    job.error = "Input no longer in storage — cannot retry";
    await persist(job);
    return snapshot(job);
  }
  job.status = "queued";
  job.progress = 0;
  job.error = null;
  await persist(job);
  enqueue(id);
  startWorker();
  return snapshot(job);
}

function enqueue(id: string) {
  if (!g.__pano360Queue!.includes(id) && g.__pano360CurrentId !== id) {
    g.__pano360Queue!.push(id);
  }
}

function startWorker() {
  if (g.__pano360WorkerRunning) return;
  g.__pano360WorkerRunning = true;
  runWorker().catch((err) => {
    console.error("Worker crashed:", err);
    g.__pano360WorkerRunning = false;
  });
}

async function runWorker() {
  try {
    while (g.__pano360Queue!.length > 0) {
      const id = g.__pano360Queue!.shift()!;
      g.__pano360CurrentId = id;
      try {
        await processOne(id);
      } catch (err) {
        console.error(`Job ${id} failed in worker:`, err);
        const job = jobs.get(id);
        if (job) {
          job.status = "failed";
          job.error = (err as Error).message || String(err);
          await persist(job);
        }
      } finally {
        procs.delete(id);
        g.__pano360CurrentId = null;
      }
    }
  } finally {
    g.__pano360WorkerRunning = false;
  }
}

async function processOne(id: string): Promise<void> {
  const job = jobs.get(id);
  if (!job) return;

  job.status = "downloading";
  job.progress = 0;
  await persist(job);

  const dir = localDir(id);
  await mkdir(dir, { recursive: true });
  const inputPath = join(dir, `input.${job.ext}`);
  const outputPath = join(dir, "output.mp4");
  await downloadToFile(jobKey(id, "input", job.ext), inputPath);

  job.status = "processing";
  await persist(job);

  await runFfmpeg(job, inputPath, outputPath);

  job.status = "uploading";
  await persist(job);

  await uploadFromFile(outputPath, jobKey(id, "output"), "video/mp4");

  try { await rm(dir, { recursive: true, force: true }); } catch {}
  try { await deleteObject(jobKey(id, "input", job.ext)); } catch {}

  job.status = "complete";
  job.progress = 100;
  job.completedAt = Date.now();
  await persist(job);
}

/** Wrap an angle into [-180, 180]. Multiple full turns are reduced to one. */
function wrap180(deg: number): number {
  const x = ((deg + 180) % 360 + 360) % 360 - 180;
  // Avoid -180 vs 180 sign quirks at the boundary
  return x === -180 ? 180 : x;
}

function runFfmpeg(job: Job, inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Normalise the alignment values into FFmpeg v360's valid ranges.
    // The UI lets the user pan freely so yaw can drift past ±180; FFmpeg
    // refuses anything outside [-180, 180]. Pitch is clamped to ±90, roll
    // wraps the same as yaw. This keeps the math identical (just a sign
    // flip if you went round the long way) while satisfying the filter.
    const yaw = wrap180(job.alignment.yaw);
    const roll = wrap180(job.alignment.roll);
    const pitch = Math.max(-90, Math.min(90, job.alignment.pitch));
    const vf = `v360=e:e:yaw=${yaw}:pitch=${pitch}:roll=${roll}:interp=lanczos`;
    const trimArgs = job.trimStart > 0 ? ["-ss", String(job.trimStart)] : [];
    const args = [
      "-y",
      "-i", inputPath,
      ...trimArgs,
      "-vf", vf,
      "-c:v", "libx264",
      "-crf", String(ENCODE_CRF),
      "-preset", "slow",
      "-pix_fmt", "yuv420p",
      "-c:a", "copy",
      "-movflags", "+faststart",
      "-metadata:s:v:0", "spherical=true",
      outputPath,
    ];

    const proc = spawn(FFMPEG, args, { stdio: ["ignore", "pipe", "pipe"] });
    procs.set(job.id, proc);

    let duration = 0;
    let lastPersist = 0;
    let stderrTail = "";

    proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderrTail = (stderrTail + text).slice(-4000);

      if (duration === 0) {
        const dm = text.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
        if (dm) duration = parseInt(dm[1]) * 3600 + parseInt(dm[2]) * 60 + parseFloat(dm[3]);
      }
      const tm = text.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (tm && duration > 0) {
        const cur = parseInt(tm[1]) * 3600 + parseInt(tm[2]) * 60 + parseFloat(tm[3]);
        const pct = Math.min(99, (cur / duration) * 100);
        job.progress = pct;
        const now = Date.now();
        if (now - lastPersist > 2000) {
          lastPersist = now;
          persist(job).catch(() => {});
        }
      }
    });

    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exit ${code}: ${stderrTail.split("\n").slice(-5).join(" ")}`));
    });
  });
}

/** Ensure boot recovery has run before any other operation. */
export async function ensureBoot(): Promise<void> {
  if (g.__pano360BootDone) return;
  g.__pano360BootDone = true;
  try {
    const ids = await listJobIds();
    for (const id of ids) {
      const job = await getJson<Job>(jobKey(id, "job"));
      if (!job) continue;

      if (job.status === "downloading" || job.status === "processing" || job.status === "uploading") {
        job.status = "queued";
        job.progress = 0;
        await putJson(jobKey(id, "job"), job);
      }

      if (job.status === "pending-upload" && Date.now() - job.createdAt > PENDING_UPLOAD_TIMEOUT_MS) {
        job.status = "failed";
        job.error = "Upload never completed";
        await putJson(jobKey(id, "job"), job);
      }

      jobs.set(id, job);
      if (job.status === "queued") enqueue(id);
    }
    if (g.__pano360Queue!.length > 0) startWorker();
  } catch (err) {
    console.error("Boot recovery failed:", err);
  }
}
