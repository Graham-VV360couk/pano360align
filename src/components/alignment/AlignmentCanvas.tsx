"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { AlignmentValues } from "@/app/page";
import {
  imageToPixels,
  renderEquirect,
  type PanoramaPixels,
} from "@/lib/equirect";
import LineOverlay, { type LineMode } from "./LineOverlay";
import LineList from "./LineList";
import {
  type ReferenceLine,
  averageRoll as computeAverageRoll,
} from "@/lib/lineMath";

interface AlignmentCanvasProps {
  frameDataURL: string;
  alignment: AlignmentValues;
  onAlignmentChange: (values: AlignmentValues) => void;
}

const FOV = 100;
const DRAG_SENSITIVITY = 0.6;
const KEY_STEP = 2;
const ROLL_KEY_STEP = 0.5;

export default function AlignmentCanvas({
  frameDataURL,
  alignment,
  onAlignmentChange,
}: AlignmentCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pixelsRef = useRef<PanoramaPixels | null>(null);
  const alignmentRef = useRef(alignment);
  const draggingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);

  const [showGuides, setShowGuides] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<LineMode>("pan");
  const [lines, setLines] = useState<ReferenceLine[]>([]);
  const [selectedLineId, setSelectedLineId] = useState<number | null>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const nextLineIdRef = useRef(1);

  // Keep latest alignment available to imperative handlers
  useEffect(() => {
    alignmentRef.current = alignment;
  }, [alignment]);

  const modeRef = useRef<LineMode>("pan");
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const draw = useCallback(() => {
    rafRef.current = null;
    const canvas = canvasRef.current;
    const pixels = pixelsRef.current;
    if (!canvas || !pixels) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(canvas.width, canvas.height);
    renderEquirect(img, pixels, { ...alignmentRef.current, fov: FOV });
    ctx.putImageData(img, 0, 0);
  }, []);

  const requestDraw = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(draw);
  }, [draw]);

  // Load image whenever the source changes
  useEffect(() => {
    setLines([]);
    setSelectedLineId(null);
    nextLineIdRef.current = 1;
    setMode("pan");
    setLoaded(false);
    pixelsRef.current = null;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      pixelsRef.current = imageToPixels(img, 4096);
      setLoaded(true);
      requestDraw();
    };
    img.src = frameDataURL;
  }, [frameDataURL, requestDraw]);

  // Re-render whenever alignment changes
  useEffect(() => {
    if (loaded) requestDraw();
  }, [alignment, loaded, requestDraw]);

  // Resize canvas to match container; render at devicePixelRatio-independent
  // resolution capped for perf (the renderer is per-pixel JS).
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const w = container.clientWidth;
      // Aspect 16:9 to match the bg-video frame; cap pixel count
      const targetW = Math.min(w, 960);
      const targetH = Math.round((targetW * 9) / 16);
      canvas.width = targetW;
      canvas.height = targetH;
      setCanvasSize({ w: targetW, h: targetH });
      canvas.style.width = "100%";
      canvas.style.height = "auto";
      requestDraw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, [requestDraw]);

  // Mouse drag for yaw/pitch
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onDown = (e: MouseEvent) => {
      if (modeRef.current !== "pan") return;
      draggingRef.current = true;
      lastPosRef.current = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const dx = e.clientX - lastPosRef.current.x;
      const dy = e.clientY - lastPosRef.current.y;
      lastPosRef.current = { x: e.clientX, y: e.clientY };
      const sensitivity = (FOV / canvas.width) * DRAG_SENSITIVITY;
      const a = alignmentRef.current;
      const next = {
        yaw: a.yaw - dx * sensitivity,
        pitch: Math.max(-85, Math.min(85, a.pitch - dy * sensitivity)),
        roll: a.roll,
      };
      onAlignmentChange(next);
    };
    const onUp = () => {
      draggingRef.current = false;
    };

    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    // Touch
    const onTouchStart = (e: TouchEvent) => {
      if (modeRef.current !== "pan") return;
      draggingRef.current = true;
      lastPosRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!draggingRef.current) return;
      const dx = e.touches[0].clientX - lastPosRef.current.x;
      const dy = e.touches[0].clientY - lastPosRef.current.y;
      lastPosRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      const sensitivity = (FOV / canvas.width) * DRAG_SENSITIVITY;
      const a = alignmentRef.current;
      onAlignmentChange({
        yaw: a.yaw - dx * sensitivity,
        pitch: Math.max(-85, Math.min(85, a.pitch - dy * sensitivity)),
        roll: a.roll,
      });
    };
    const onTouchEnd = () => {
      draggingRef.current = false;
    };
    canvas.addEventListener("touchstart", onTouchStart, { passive: true });
    canvas.addEventListener("touchmove", onTouchMove, { passive: true });
    canvas.addEventListener("touchend", onTouchEnd);

    return () => {
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
    };
  }, [onAlignmentChange]);

  // Keyboard controls
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = alignmentRef.current;
      let handled = true;
      const next = { ...a };
      switch (e.key) {
        case "ArrowLeft":
          next.yaw = a.yaw - KEY_STEP;
          break;
        case "ArrowRight":
          next.yaw = a.yaw + KEY_STEP;
          break;
        case "ArrowUp":
          next.pitch = Math.min(85, a.pitch + KEY_STEP);
          break;
        case "ArrowDown":
          next.pitch = Math.max(-85, a.pitch - KEY_STEP);
          break;
        case "q":
        case "Q":
          next.roll = Math.max(-45, a.roll - ROLL_KEY_STEP);
          break;
        case "e":
        case "E":
          next.roll = Math.min(45, a.roll + ROLL_KEY_STEP);
          break;
        default:
          handled = false;
      }
      if (handled) {
        e.preventDefault();
        onAlignmentChange(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onAlignmentChange]);

  const handleCommitLine = useCallback(
    (line: Omit<ReferenceLine, "id">) => {
      const id = nextLineIdRef.current++;
      const next = [...lines, { ...line, id }];
      setLines(next);
      const avg = computeAverageRoll(next.map((l) => l.derivedRoll));
      onAlignmentChange({ ...alignmentRef.current, roll: avg });
    },
    [lines, onAlignmentChange]
  );

  const handleDeleteLine = useCallback(
    (id: number) => {
      const next = lines.filter((l) => l.id !== id);
      setLines(next);
      if (selectedLineId === id) setSelectedLineId(null);
      const avg = computeAverageRoll(next.map((l) => l.derivedRoll));
      onAlignmentChange({ ...alignmentRef.current, roll: avg });
    },
    [lines, selectedLineId, onAlignmentChange]
  );

  const handleClearAllLines = useCallback(() => {
    setLines([]);
    setSelectedLineId(null);
  }, []);

  const fmt = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}°`;

  return (
    <section className="border border-border-subtle rounded-lg overflow-hidden">
      <div ref={containerRef} className="relative bg-black/50 select-none">
        <canvas
          ref={canvasRef}
          className="block w-full cursor-grab active:cursor-grabbing"
        />
        {showGuides && (
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute left-0 right-0 top-1/2 h-px bg-accent/60" />
            <div className="absolute top-0 bottom-0 left-1/2 w-px bg-accent/30" />
          </div>
        )}
        <LineOverlay
          width={canvasSize.w}
          height={canvasSize.h}
          view={{ ...alignment, fov: FOV }}
          lines={lines}
          selectedLineId={selectedLineId}
          mode={mode}
          onCommitLine={handleCommitLine}
          onSelectLine={setSelectedLineId}
          onDeleteLine={handleDeleteLine}
        />
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="font-mono text-xs text-text-muted">Loading…</p>
          </div>
        )}
      </div>

      <div className="border-t border-border-subtle px-4 py-3 space-y-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-text-muted w-10">Tool</span>
          {(["pan", "h-line", "v-line"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1 rounded font-mono text-xs border transition-colors ${
                mode === m
                  ? "border-accent text-accent bg-accent/10"
                  : "border-border-subtle text-text-muted hover:border-accent/30"
              }`}
            >
              {m === "pan" ? "Pan" : m === "h-line" ? "H Line" : "V Line"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4">
          <label className="font-mono text-xs text-text-muted w-10">Roll</label>
          <input
            type="range"
            min={-45}
            max={45}
            step={0.1}
            value={alignment.roll}
            onChange={(e) =>
              onAlignmentChange({ ...alignment, roll: parseFloat(e.target.value) })
            }
            className="flex-1"
          />
          <span className="font-mono text-xs text-accent w-16 text-right">
            {fmt(alignment.roll)}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex gap-6 font-mono text-xs">
            <span className="text-text-muted">
              YAW <span className="text-foreground ml-1">{fmt(alignment.yaw)}</span>
            </span>
            <span className="text-text-muted">
              PITCH <span className="text-foreground ml-1">{fmt(alignment.pitch)}</span>
            </span>
            <span className="text-text-muted">
              ROLL <span className="text-accent ml-1">{fmt(alignment.roll)}</span>
            </span>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setShowGuides((s) => !s)}
              className={`font-mono text-xs transition-colors ${
                showGuides ? "text-accent" : "text-text-muted hover:text-foreground"
              }`}
            >
              Guide lines
            </button>
            <button
              onClick={() => {
                onAlignmentChange({ yaw: 0, pitch: 0, roll: 0 });
                setLines([]);
                setSelectedLineId(null);
              }}
              className="font-mono text-xs text-text-muted hover:text-foreground transition-colors"
            >
              Reset
            </button>
          </div>
        </div>
      </div>
      <LineList
        lines={lines}
        averageRoll={computeAverageRoll(lines.map((l) => l.derivedRoll))}
        onDelete={handleDeleteLine}
        onClearAll={handleClearAllLines}
      />
    </section>
  );
}
