"use client";

import { useEffect, useState, useCallback } from "react";
import {
  listClientJobs,
  removeClientJob,
  clearCompletedClientJobs,
  type ClientJobRef,
} from "@/lib/clientJobs";
import { backgroundUploads, MAX_CONCURRENT_UPLOADS } from "@/lib/uploadManager";

interface JobSnapshot {
  id: string;
  filename: string;
  status:
    | "pending-upload"
    | "queued"
    | "downloading"
    | "processing"
    | "uploading"
    | "complete"
    | "failed";
  progress: number;
  error: string | null;
  queuePosition: number;
}

const ACTIVE_POLL_MS = 3000;
const IDLE_POLL_MS = 15000;

export default function JobList() {
  const [refs, setRefs] = useState<ClientJobRef[]>([]);
  const [snaps, setSnaps] = useState<Record<string, JobSnapshot>>({});
  const [open, setOpen] = useState(true);

  // Re-render counter — incremented whenever the upload manager fires a
  // progress event so the visible bars stay in sync.
  const [, setUploadTick] = useState(0);
  useEffect(() => {
    return backgroundUploads.subscribe(() => {
      setUploadTick((t) => t + 1);
    });
  }, []);

  // Initial load + listen for storage changes from this tab via custom event
  const reload = useCallback(() => {
    setRefs(listClientJobs());
  }, []);

  useEffect(() => {
    reload();
    const onCustom = () => reload();
    window.addEventListener("pano360.jobs.changed", onCustom);
    window.addEventListener("storage", onCustom);
    return () => {
      window.removeEventListener("pano360.jobs.changed", onCustom);
      window.removeEventListener("storage", onCustom);
    };
  }, [reload]);

  // Polling
  useEffect(() => {
    if (refs.length === 0) return;
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch("/api/jobs/list", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: refs.map((r) => r.id) }),
        });
        if (!res.ok) return;
        const list = (await res.json()) as JobSnapshot[];
        if (cancelled) return;
        const next: Record<string, JobSnapshot> = {};
        for (const s of list) next[s.id] = s;
        setSnaps(next);
      } catch {}
    }
    tick();
    const anyActive = refs.some((r) => {
      const s = snaps[r.id];
      return !s || (s.status !== "complete" && s.status !== "failed");
    });
    const interval = anyActive ? ACTIVE_POLL_MS : IDLE_POLL_MS;
    const id = setInterval(tick, interval);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refs]);

  const dismiss = async (id: string) => {
    backgroundUploads.cancel(id);
    removeClientJob(id);
    reload();
    try {
      await fetch(`/api/job/${id}`, { method: "DELETE" });
    } catch {}
  };

  const retry = async (id: string) => {
    try {
      await fetch(`/api/job/${id}/retry`, { method: "POST" });
    } catch {}
  };

  const clearDone = () => {
    const completed = new Set<string>();
    for (const r of refs) {
      const s = snaps[r.id];
      if (s && s.status === "complete") completed.add(r.id);
    }
    clearCompletedClientJobs(completed);
    reload();
  };

  return (
    <section className="border border-border-subtle rounded-lg overflow-hidden">
      <header
        className="flex items-center justify-between px-4 py-2 cursor-pointer select-none bg-black/30"
        onClick={() => setOpen((o) => !o)}
      >
        <h2 className="font-heading text-sm font-medium">
          Jobs ({refs.length})
        </h2>
        <div className="flex items-center gap-3">
          <label
            className="flex items-center gap-1.5 font-mono text-[11px] text-text-muted cursor-pointer"
            onClick={(e) => e.stopPropagation()}
            title={`Number of uploads that run in parallel. Max ${MAX_CONCURRENT_UPLOADS}. Higher is faster on fast links but can backfire on home broadband.`}
          >
            <span>Parallel uploads</span>
            <select
              value={backgroundUploads.getMaxConcurrent()}
              onChange={(e) => {
                backgroundUploads.setMaxConcurrent(parseInt(e.target.value, 10));
              }}
              className="bg-black/40 border border-border-subtle rounded px-1 py-0.5 font-mono text-[11px]"
            >
              {Array.from({ length: MAX_CONCURRENT_UPLOADS }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={(e) => {
              e.stopPropagation();
              clearDone();
            }}
            className="font-mono text-xs text-text-muted hover:text-foreground"
          >
            Clear done
          </button>
          <span className="font-mono text-xs text-text-muted">{open ? "▾" : "▸"}</span>
        </div>
      </header>
      {open && refs.length === 0 && (
        <div className="px-4 py-4 text-xs font-mono text-text-muted">
          No jobs yet — produce a video and it&apos;ll appear here. The list
          persists across page reloads.
        </div>
      )}
      {open && refs.length > 0 && (
        <ul className="max-h-72 overflow-y-auto divide-y divide-border-subtle">
          {refs.map((ref) => {
            const s = snaps[ref.id];
            let status: string = s?.status ?? "pending-upload";
            let displayProgress = s?.progress ?? 0;

            // Overlay client-side upload state for jobs the server still considers pending-upload.
            if (status === "pending-upload") {
              if (backgroundUploads.isActive(ref.id)) {
                status = "client-uploading";
                displayProgress = backgroundUploads.getProgress(ref.id);
              } else if (backgroundUploads.isQueued(ref.id)) {
                status = "client-queued";
              } else if (backgroundUploads.hasFailed(ref.id)) {
                status = "client-failed";
              }
              // else: still "pending-upload" — the page was reloaded and the manager
              // doesn't know about this job; the server's 30-min timeout will handle it.
            }
            return (
              <li key={ref.id} className="px-4 py-3 flex items-center gap-3 text-xs font-mono">
                <StatusGlyph status={status} />
                <div className="flex-1 min-w-0">
                  <div className="truncate text-foreground">{ref.filename}</div>
                  <div className="text-text-muted">
                    {statusLabel(status, s, displayProgress)}
                    {s?.error && <span className="text-red-300 ml-2">— {s.error}</span>}
                  </div>
                  {(status === "processing" ||
                    status === "downloading" ||
                    status === "uploading" ||
                    status === "client-uploading") && (
                    <div className="h-1 mt-1.5 rounded-full bg-black/40 overflow-hidden">
                      <div
                        className="h-full bg-accent transition-all"
                        style={{ width: `${displayProgress}%` }}
                      />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {status === "complete" && (
                    <a
                      href={`/api/download/${ref.id}`}
                      className="px-2 py-1 rounded border border-accent/40 text-accent hover:bg-accent/10"
                    >
                      ↓ Get
                    </a>
                  )}
                  {status === "failed" && (
                    <button
                      onClick={() => retry(ref.id)}
                      className="px-2 py-1 rounded border border-border-subtle hover:border-accent/30"
                    >
                      ↻ Retry
                    </button>
                  )}
                  <button
                    onClick={() => dismiss(ref.id)}
                    className="px-2 py-1 rounded text-text-muted hover:text-foreground"
                    title="Dismiss"
                  >
                    ✕
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function StatusGlyph({ status }: { status: string }) {
  const map: Record<string, { ch: string; cls: string }> = {
    "pending-upload": { ch: "↑", cls: "text-text-muted" },
    queued: { ch: "⏸", cls: "text-text-muted" },
    downloading: { ch: "⇣", cls: "text-accent" },
    processing: { ch: "⟳", cls: "text-accent" },
    uploading: { ch: "⇡", cls: "text-accent" },
    "client-uploading": { ch: "↑", cls: "text-accent" },
    "client-queued":    { ch: "↑", cls: "text-text-muted" },
    "client-failed":    { ch: "✗", cls: "text-red-400" },
    complete: { ch: "✓", cls: "text-green-400" },
    failed: { ch: "✗", cls: "text-red-400" },
  };
  const m = map[status] || { ch: "?", cls: "text-text-muted" };
  return <span className={`text-base ${m.cls}`}>{m.ch}</span>;
}

function statusLabel(status: string, s: JobSnapshot | undefined, displayProgress?: number): string {
  switch (status) {
    case "pending-upload":
      return "Uploading…";
    case "client-uploading":
      return `Uploading ${(displayProgress ?? 0).toFixed(0)}%`;
    case "client-queued":
      return "Waiting to upload";
    case "client-failed":
      return "Upload failed";
    case "queued":
      return s && s.queuePosition > 0 ? `Queued (#${s.queuePosition})` : "Queued";
    case "downloading":
      return "Fetching from storage…";
    case "processing":
      return `Processing ${(s?.progress ?? 0).toFixed(0)}%`;
    case "uploading":
      return "Saving to storage…";
    case "complete":
      return "Complete";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}
