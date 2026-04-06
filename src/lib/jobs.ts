import { EventEmitter } from "events";
import { join } from "path";

export const TEMP_DIR = process.env.TEMP_DIR || "/tmp/360aligner";
export const OUTPUT_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

export type JobStatus =
  | "uploaded"
  | "queued"
  | "processing"
  | "complete"
  | "failed"
  | "expired";

export interface Job {
  id: string;
  filename: string;
  inputPath: string;
  outputPath: string;
  status: JobStatus;
  progress: number;
  error?: string;
  duration?: number; // input video duration in seconds
  process?: import("child_process").ChildProcess;
  events: EventEmitter;
  createdAt: number;
  completedAt?: number;
  cleanupTimer?: NodeJS.Timeout;
}

// Persist on globalThis to survive Next.js dev hot reloads.
const g = globalThis as unknown as { __pano360Jobs?: Map<string, Job> };
if (!g.__pano360Jobs) g.__pano360Jobs = new Map();
const jobs = g.__pano360Jobs;

export function createJob(id: string, filename: string, inputPath: string): Job {
  const job: Job = {
    id,
    filename,
    inputPath,
    outputPath: join(TEMP_DIR, id, "output.mp4"),
    status: "uploaded",
    progress: 0,
    events: new EventEmitter(),
    createdAt: Date.now(),
  };
  // EventEmitter default max is 10 — bump for safety on multi-subscriber SSE
  job.events.setMaxListeners(50);
  jobs.set(id, job);
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function deleteJob(id: string): void {
  const job = jobs.get(id);
  if (job?.cleanupTimer) clearTimeout(job.cleanupTimer);
  jobs.delete(id);
}

export function updateJob(id: string, patch: Partial<Job>): Job | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;
  Object.assign(job, patch);
  job.events.emit("update", { ...snapshot(job) });
  return job;
}

export interface JobSnapshot {
  id: string;
  status: JobStatus;
  progress: number;
  error?: string;
  filename: string;
}

export function snapshot(job: Job): JobSnapshot {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error,
    filename: job.filename,
  };
}
