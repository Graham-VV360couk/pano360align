"use client";

const STORAGE_KEY = "pano360.jobs";

export interface ClientJobRef {
  id: string;
  filename: string;
  submittedAt: number;
}

function read(): ClientJobRef[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(refs: ClientJobRef[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(refs));
  } catch (err) {
    console.error("Failed to persist client jobs:", err);
  }
}

export function listClientJobs(): ClientJobRef[] {
  return read();
}

export function addClientJob(ref: ClientJobRef): void {
  const refs = read();
  if (refs.some((r) => r.id === ref.id)) return;
  refs.unshift(ref); // newest first
  write(refs);
}

export function removeClientJob(id: string): void {
  write(read().filter((r) => r.id !== id));
}

export function clearCompletedClientJobs(completedIds: Set<string>): void {
  write(read().filter((r) => !completedIds.has(r.id)));
}
