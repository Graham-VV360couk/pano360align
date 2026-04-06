"use client";

import type { AlignmentValues } from "@/app/page";

interface AlignmentCanvasProps {
  frameDataURL: string;
  alignment: AlignmentValues;
  onAlignmentChange: (values: AlignmentValues) => void;
}

/**
 * TODO: Implement the equirectangular alignment canvas.
 *
 * This component must:
 * - Render the equirectangular image using ray-casting (port from PanoAlign viewer)
 * - Support mouse drag for yaw/pitch control
 * - Support roll slider for horizon correction
 * - Show guide lines (horizontal + vertical crosshair)
 * - Display live YAW / PITCH / ROLL readout
 * - Reset button
 * - Fixed FOV at 100°
 * - Downsample input to max 4096x2048 for performance
 *
 * See docs/ALIGNMENT.md for full spec.
 * Port render loop from EquiRecover reference/viewer-prototype.html.
 */
export default function AlignmentCanvas({ frameDataURL, alignment, onAlignmentChange }: AlignmentCanvasProps) {
  return (
    <section className="border border-border-subtle rounded-lg overflow-hidden">
      {/* Canvas will go here — frameDataURL is the image source */}
      <div className="aspect-video bg-black/50 flex items-center justify-center" data-src={frameDataURL}>
        <p className="font-mono text-xs text-text-muted">
          Alignment canvas — not yet implemented
        </p>
      </div>

      {/* Controls bar */}
      <div className="border-t border-border-subtle px-4 py-3 space-y-3">
        {/* Roll slider */}
        <div className="flex items-center gap-4">
          <label className="font-mono text-xs text-text-muted w-10">Roll</label>
          <input
            type="range"
            min={-45}
            max={45}
            step={0.1}
            value={alignment.roll}
            onChange={(e) => onAlignmentChange({ ...alignment, roll: parseFloat(e.target.value) })}
            className="flex-1"
          />
          <span className="font-mono text-xs text-accent w-16 text-right">
            {alignment.roll >= 0 ? "+" : ""}{alignment.roll.toFixed(1)}°
          </span>
        </div>

        {/* Readout */}
        <div className="flex items-center justify-between">
          <div className="flex gap-6 font-mono text-xs">
            <span className="text-text-muted">
              YAW <span className="text-foreground ml-1">{alignment.yaw >= 0 ? "+" : ""}{alignment.yaw.toFixed(1)}°</span>
            </span>
            <span className="text-text-muted">
              PITCH <span className="text-foreground ml-1">{alignment.pitch >= 0 ? "+" : ""}{alignment.pitch.toFixed(1)}°</span>
            </span>
            <span className="text-text-muted">
              ROLL <span className="text-accent ml-1">{alignment.roll >= 0 ? "+" : ""}{alignment.roll.toFixed(1)}°</span>
            </span>
          </div>
          <div className="flex gap-3">
            <button className="font-mono text-xs text-text-muted hover:text-foreground transition-colors">
              Guide lines
            </button>
            <button
              onClick={() => onAlignmentChange({ yaw: 0, pitch: 0, roll: 0 })}
              className="font-mono text-xs text-text-muted hover:text-foreground transition-colors"
            >
              Reset
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
