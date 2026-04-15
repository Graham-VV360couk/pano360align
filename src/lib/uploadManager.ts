"use client";

/**
 * Background upload manager for direct browser → S3 PUTs.
 *
 * The user clicks Produce, the server creates a job and returns a presigned
 * PUT URL, and we hand that to this manager. It runs N parallel uploads in
 * the background while the user immediately moves on to the next file.
 *
 * The manager is a singleton in the module scope. It survives navigation
 * between pages but NOT a full page reload — XHRs are in-memory only. The
 * server side has its own 30-minute timeout for orphaned pending-upload jobs.
 */

interface UploadEntry {
  id: string;        // matches the server jobId
  putUrl: string;    // presigned S3 URL
  file: File;        // the actual blob
  filename: string;
  size: number;
}

type ProgressMap = Record<string, number>; // jobId → 0-100

// Hard cap on concurrency. Above ~8 you hit diminishing returns from TCP
// fairness and S3 per-connection throughput, and start risking rate limits.
export const MAX_CONCURRENT_UPLOADS = 8;
const CONCURRENCY_STORAGE_KEY = "pano360.maxConcurrent";

function readStoredConcurrency(): number {
  if (typeof window === "undefined") return 1;
  try {
    const raw = window.localStorage.getItem(CONCURRENCY_STORAGE_KEY);
    if (!raw) return 1;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return 1;
    return Math.max(1, Math.min(MAX_CONCURRENT_UPLOADS, n));
  } catch {
    return 1;
  }
}

class BackgroundUploadManager {
  private queue: UploadEntry[] = [];
  private active: Map<string, XMLHttpRequest> = new Map();
  private progress: ProgressMap = {};
  private failed: Set<string> = new Set();
  private listeners: Set<() => void> = new Set();
  // Default 1 is the safe choice for typical home links. User can raise up
  // to MAX_CONCURRENT_UPLOADS via the control in the JobList header.
  private maxConcurrent = readStoredConcurrency();

  getMaxConcurrent(): number {
    return this.maxConcurrent;
  }

  setMaxConcurrent(n: number): void {
    const clamped = Math.max(1, Math.min(MAX_CONCURRENT_UPLOADS, Math.floor(n)));
    if (clamped === this.maxConcurrent) return;
    this.maxConcurrent = clamped;
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(CONCURRENCY_STORAGE_KEY, String(clamped));
      } catch {}
    }
    this.notify();
    // If we raised the cap, start any queued uploads that now fit.
    this.tick();
  }

  enqueue(entry: UploadEntry): void {
    this.queue.push(entry);
    this.progress[entry.id] = 0;
    this.failed.delete(entry.id);
    this.notify();
    this.tick();
  }

  cancel(id: string): void {
    const xhr = this.active.get(id);
    if (xhr) {
      try {
        xhr.abort();
      } catch {}
      this.active.delete(id);
    }
    this.queue = this.queue.filter((e) => e.id !== id);
    delete this.progress[id];
    this.failed.delete(id);
    this.notify();
    this.tick();
  }

  isActive(id: string): boolean {
    return this.active.has(id);
  }

  isQueued(id: string): boolean {
    return this.queue.some((e) => e.id === id);
  }

  hasFailed(id: string): boolean {
    return this.failed.has(id);
  }

  getProgress(id: string): number {
    return this.progress[id] ?? 0;
  }

  /** True when the manager has any non-terminal work — used to gate
   *  "don't reload the page" warnings in the UI. */
  hasActiveWork(): boolean {
    return this.active.size > 0 || this.queue.length > 0;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.listeners.forEach((l) => {
      try {
        l();
      } catch {}
    });
  }

  private tick(): void {
    while (this.active.size < this.maxConcurrent && this.queue.length > 0) {
      const entry = this.queue.shift()!;
      this.startUpload(entry);
    }
  }

  private startUpload(entry: UploadEntry): void {
    const xhr = new XMLHttpRequest();
    this.active.set(entry.id, xhr);
    this.progress[entry.id] = 0;
    this.notify();

    xhr.open("PUT", entry.putUrl);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        this.progress[entry.id] = (e.loaded / e.total) * 100;
        this.notify();
      }
    };

    xhr.onload = async () => {
      this.active.delete(entry.id);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          await fetch("/api/upload-complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId: entry.id }),
          });
        } catch (err) {
          console.error(`upload-complete failed for ${entry.id}:`, err);
          this.failed.add(entry.id);
        }
        this.progress[entry.id] = 100;
      } else {
        console.error(`S3 PUT failed for ${entry.id}: ${xhr.status} ${xhr.responseText}`);
        this.failed.add(entry.id);
      }
      this.notify();
      this.tick();
    };

    xhr.onerror = () => {
      this.active.delete(entry.id);
      this.failed.add(entry.id);
      console.error(`S3 PUT network error for ${entry.id}`);
      this.notify();
      this.tick();
    };

    xhr.onabort = () => {
      this.active.delete(entry.id);
      this.notify();
      this.tick();
    };

    xhr.send(entry.file);
  }
}

export const backgroundUploads = new BackgroundUploadManager();

// Make it accessible for debugging in dev
if (typeof window !== "undefined") {
  (window as unknown as { __pano360Uploads?: BackgroundUploadManager }).__pano360Uploads =
    backgroundUploads;
}

// Warn the user if they try to close the page with active uploads.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (backgroundUploads.hasActiveWork()) {
      e.preventDefault();
      e.returnValue =
        "Uploads are still in progress. Reloading or closing will lose them.";
      return e.returnValue;
    }
  });
}
