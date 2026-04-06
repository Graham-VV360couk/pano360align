"use client";

import type { AlignmentValues } from "@/app/page";

interface VideoSectionProps {
  file: File;
  alignment: AlignmentValues;
  onFrameSelected: (dataURL: string) => void;
  frameSelected: boolean;
}

/**
 * TODO: Implement the full video section.
 *
 * Sub-components needed:
 * 1. ThumbnailStrip — macro overview of the video (see docs/SCRUBBER.md)
 * 2. ScrubBar — full-width range input with timecode
 * 3. HoverPreview — 240x135 floating canvas following cursor
 * 4. ReferenceCanvas — 320x180 showing current playhead frame
 * 5. TransportControls — play/pause, frame step, 10s jump
 * 6. UseThisFrameButton — captures frame and sends to alignment canvas
 * 7. Advisory — permanent warning about whole-file application
 * 8. RetrieveValues — reads alignment values from canvas
 * 9. ProduceButton — submits job to server
 * 10. ProgressBar — SSE-driven progress display
 * 11. DownloadButton — appears on completion
 *
 * See docs/SCRUBBER.md, docs/UI.md, docs/PROCESSING.md, docs/WARNINGS.md.
 */
export default function VideoSection({ file, alignment, onFrameSelected, frameSelected }: VideoSectionProps) {
  // TODO: These props will be used when implementing the full video workflow
  // file → hidden <video> element source
  // alignment → displayed in "Retrieve Values" readout
  // onFrameSelected → called by "Use this frame" button
  void file; void alignment; void onFrameSelected;

  return (
    <section className="border border-border-subtle rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border-subtle">
        <h2 className="font-heading text-sm font-medium">VIDEO</h2>
      </div>

      <div className="p-4 space-y-4">
        {/* Thumbnail strip placeholder */}
        <div className="h-16 bg-black/30 rounded flex items-center justify-center">
          <p className="font-mono text-xs text-text-muted">Thumbnail strip — not yet implemented</p>
        </div>

        {/* Scrub bar placeholder */}
        <input type="range" min={0} max={100} defaultValue={0} className="w-full" />

        {/* Transport controls placeholder */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-[320px] h-[180px] bg-black/30 rounded flex items-center justify-center">
              <p className="font-mono text-[0.6rem] text-text-muted">Reference canvas</p>
            </div>
          </div>
          <div className="flex items-center gap-2 font-mono text-xs">
            <button className="px-2 py-1 border border-border-subtle rounded hover:border-accent/30">&#9664;&#9664;</button>
            <button className="px-2 py-1 border border-border-subtle rounded hover:border-accent/30">&#9664;1</button>
            <button className="px-2 py-1 border border-border-subtle rounded hover:border-accent/30">&#9654;/&#9646;&#9646;</button>
            <button className="px-2 py-1 border border-border-subtle rounded hover:border-accent/30">1&#9654;</button>
            <button className="px-2 py-1 border border-border-subtle rounded hover:border-accent/30">&#9654;&#9654;</button>
          </div>
          <span className="font-mono text-xs text-text-muted">00:00:00 / --:--:--</span>
        </div>

        {/* Use this frame */}
        <button className="w-full py-3 rounded-lg bg-accent/10 border border-accent/30 text-accent font-heading text-sm font-medium hover:bg-accent/20 transition-colors">
          USE THIS FRAME
        </button>

        {/* Advisory */}
        <div className="rounded-lg bg-yellow-500/5 border border-yellow-500/20 px-4 py-3">
          <p className="font-mono text-xs text-yellow-200/70 leading-relaxed">
            These values will be applied to every frame of your video — from the very first
            to the very last. If your video contains setup footage or camera movement, those
            frames will also be corrected. Trim your source file first if needed.
          </p>
        </div>

        {/* Retrieve values + Produce — disabled until frame selected */}
        <div className="flex gap-3">
          <button
            disabled={!frameSelected}
            className="flex-1 py-3 rounded-lg border border-border-subtle font-heading text-sm font-medium disabled:opacity-30 disabled:cursor-not-allowed hover:border-accent/30 transition-colors"
          >
            Retrieve Alignment Values
          </button>
          <button
            disabled
            className="flex-1 py-3 rounded-lg bg-accent/10 border border-accent/30 text-accent font-heading text-sm font-medium disabled:opacity-30 disabled:cursor-not-allowed hover:bg-accent/20 transition-colors"
          >
            Produce
          </button>
        </div>
      </div>
    </section>
  );
}
