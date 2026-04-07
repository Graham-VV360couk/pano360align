"use client";

/**
 * Persist the most recently submitted alignment values across sessions so
 * the user can one-click reuse them on the next video. Saved on Produce,
 * not on every drag — only confirmed values get remembered.
 */

const STORAGE_KEY = "pano360.lastAlignment";

export interface SavedAlignment {
  yaw: number;
  pitch: number;
  roll: number;
  /** Preview FOV used at the moment of submission. Optional for back-compat
   *  with older saved entries that didn't include it. */
  fov?: number;
  savedAt: number;
}

export function getLastAlignment(): SavedAlignment | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.yaw === "number" &&
      typeof parsed?.pitch === "number" &&
      typeof parsed?.roll === "number"
    ) {
      return parsed as SavedAlignment;
    }
    return null;
  } catch {
    return null;
  }
}

export function setLastAlignment(values: {
  yaw: number;
  pitch: number;
  roll: number;
  fov?: number;
}): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...values, savedAt: Date.now() })
    );
  } catch (err) {
    console.error("Failed to persist last alignment:", err);
  }
}
