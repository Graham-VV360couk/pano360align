"use client";

import type { AlignmentValues } from "@/app/page";

interface StillExportProps {
  frameDataURL: string;
  alignment: AlignmentValues;
  fileName: string;
}

/**
 * TODO: Implement still image export.
 *
 * On click: render current canvas at full source resolution,
 * apply yaw/pitch/roll correction, trigger download.
 * Output: {original-name}-aligned.jpg
 * Pure client-side — no server required.
 *
 * See docs/UI.md "Still image export section".
 */
export default function StillExport({ frameDataURL, alignment, fileName }: StillExportProps) {
  function handleExport() {
    // TODO: Render corrected image at full resolution and trigger download
    // Will use frameDataURL as source, apply alignment correction, save as {fileName}-aligned.jpg
    console.log("Export:", { frameDataURL, alignment, fileName });
    alert("Still export not yet implemented");
  }

  return (
    <section className="border border-border-subtle rounded-lg px-4 py-4">
      <button
        onClick={handleExport}
        className="w-full py-3 rounded-lg bg-accent/10 border border-accent/30 text-accent font-heading text-sm font-medium hover:bg-accent/20 transition-colors"
      >
        Export corrected image
      </button>
    </section>
  );
}
