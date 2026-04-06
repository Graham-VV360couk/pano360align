"use client";

import { useState } from "react";
import type { AlignmentValues } from "@/app/page";
import { imageToPixels, renderCorrectedEquirect } from "@/lib/equirect";

interface StillExportProps {
  frameDataURL: string;
  alignment: AlignmentValues;
  fileName: string;
}

export default function StillExport({
  frameDataURL,
  alignment,
  fileName,
}: StillExportProps) {
  const [busy, setBusy] = useState(false);

  async function handleExport() {
    if (busy) return;
    setBusy(true);
    try {
      const img = await loadImage(frameDataURL);
      // Full source resolution — no downsample for export
      const src = imageToPixels(img, Number.POSITIVE_INFINITY);
      const out = renderCorrectedEquirect(src, alignment);

      const oc = document.createElement("canvas");
      oc.width = out.width;
      oc.height = out.height;
      oc.getContext("2d")!.putImageData(out, 0, 0);

      const blob: Blob = await new Promise((resolve, reject) =>
        oc.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
          "image/jpeg",
          0.95
        )
      );

      const base = fileName.replace(/\.[^.]+$/, "") || "image";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${base}-aligned.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error(err);
      alert("Export failed: " + (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border border-border-subtle rounded-lg px-4 py-4">
      <button
        onClick={handleExport}
        disabled={busy}
        className="w-full py-3 rounded-lg bg-accent/10 border border-accent/30 text-accent font-heading text-sm font-medium hover:bg-accent/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? "Rendering…" : "Export corrected image"}
      </button>
    </section>
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = src;
  });
}
