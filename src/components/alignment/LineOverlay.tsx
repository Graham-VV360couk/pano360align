"use client";

import { useEffect, useRef, useState } from "react";
import type { RenderParams } from "@/lib/equirect";
import {
  type ReferenceLine,
  type LineOrientation,
  projectSphericalToScreen,
  screenToSpherical,
  distanceToSegment,
  derivedRollFromScreenAngle,
} from "@/lib/lineMath";

export type LineMode = "pan" | "h-line" | "v-line";

interface LineOverlayProps {
  width: number;
  height: number;
  view: RenderParams;
  lines: ReferenceLine[];
  selectedLineId: number | null;
  mode: LineMode;
  onCommitLine: (line: Omit<ReferenceLine, "id">) => void;
  onSelectLine: (id: number | null) => void;
  onDeleteLine: (id: number) => void;
}

const HIT_THRESHOLD = 6;

export default function LineOverlay({
  width,
  height,
  view,
  lines,
  selectedLineId,
  mode,
  onCommitLine,
  onSelectLine,
  onDeleteLine,
}: LineOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; lineId: number } | null>(null);

  const toCanvasCoords = (clientX: number, clientY: number) => {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return {
      x: ((clientX - r.left) * c.width) / r.width,
      y: ((clientY - r.top) * c.height) / r.height,
    };
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);

    for (const line of lines) {
      const a = projectSphericalToScreen(line.a.yaw, line.a.pitch, width, height, view);
      const b = projectSphericalToScreen(line.b.yaw, line.b.pitch, width, height, view);
      if (!a.visible || !b.visible) continue;

      ctx.strokeStyle = "#00e5ff";
      ctx.lineWidth = line.id === selectedLineId ? 3 : 2;
      ctx.setLineDash(line.orientation === "vertical" ? [8, 6] : []);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);

      for (const p of [a, b]) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,229,255,0.7)";
        ctx.fill();
        ctx.strokeStyle = "#00e5ff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      const mx = (a.x + b.x) / 2;
      const my = Math.min(a.y, b.y) - 10;
      const label = `${line.orientation === "horizontal" ? "H" : "V"} · ${
        line.derivedRoll >= 0 ? "+" : ""
      }${line.derivedRoll.toFixed(1)}°`;
      ctx.font = '500 11px "DM Mono", monospace';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const w = ctx.measureText(label).width + 12;
      const h = 18;
      ctx.fillStyle = "rgba(10,10,15,0.85)";
      ctx.fillRect(mx - w / 2, my - h / 2, w, h);
      ctx.strokeStyle = "#00e5ff";
      ctx.lineWidth = 1;
      ctx.strokeRect(mx - w / 2, my - h / 2, w, h);
      ctx.fillStyle = "#00e5ff";
      ctx.fillText(label, mx, my);
    }

    if (drag && (mode === "h-line" || mode === "v-line")) {
      ctx.strokeStyle = "#00e5ff";
      ctx.lineWidth = 2;
      ctx.setLineDash(mode === "v-line" ? [8, 6] : []);
      ctx.beginPath();
      ctx.moveTo(drag.x1, drag.y1);
      ctx.lineTo(drag.x2, drag.y2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [width, height, view, lines, selectedLineId, drag, mode]);

  function hitTestLines(x: number, y: number): number | null {
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      const pa = projectSphericalToScreen(line.a.yaw, line.a.pitch, width, height, view);
      const pb = projectSphericalToScreen(line.b.yaw, line.b.pitch, width, height, view);
      if (!pa.visible || !pb.visible) continue;
      if (distanceToSegment(x, y, pa.x, pa.y, pb.x, pb.y) <= HIT_THRESHOLD) {
        return line.id;
      }
    }
    return null;
  }

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2) return;
    const { x, y } = toCanvasCoords(e.clientX, e.clientY);

    if (mode === "h-line" || mode === "v-line") {
      setDrag({ x1: x, y1: y, x2: x, y2: y });
      return;
    }

    const hit = hitTestLines(x, y);
    onSelectLine(hit);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!drag) return;
    const { x, y } = toCanvasCoords(e.clientX, e.clientY);
    setDrag({ ...drag, x2: x, y2: y });
  };

  const onMouseUp = () => {
    if (!drag) return;
    const { x1, y1, x2, y2 } = drag;
    setDrag(null);

    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 10) return;

    const orientation: LineOrientation = mode === "v-line" ? "vertical" : "horizontal";
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const derivedRoll = derivedRollFromScreenAngle(angle, orientation);
    const a = screenToSpherical(x1, y1, width, height, view);
    const b = screenToSpherical(x2, y2, width, height, view);
    onCommitLine({ orientation, a, b, derivedRoll });
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const { x, y } = toCanvasCoords(e.clientX, e.clientY);
    const hit = hitTestLines(x, y);
    if (hit != null) {
      setContextMenu({ x: e.clientX, y: e.clientY, lineId: hit });
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedLineId != null) {
        onDeleteLine(selectedLineId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedLineId, onDeleteLine]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [contextMenu]);

  return (
    <>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => setDrag(null)}
        onContextMenu={onContextMenu}
        className="absolute inset-0"
        style={{
          width: "100%",
          height: "100%",
          // In Pan mode the overlay must NOT swallow drag events — they need
          // to reach the underlying canvas's drag-to-yaw/pitch handler. The
          // overlay is purely visual in Pan mode; line management happens via
          // the LineList × buttons.
          pointerEvents: mode === "pan" ? "none" : "auto",
          cursor:
            mode === "pan"
              ? lines.length > 0
                ? "pointer"
                : "default"
              : "crosshair",
        }}
      />
      {contextMenu && (
        <div
          className="fixed z-50 rounded border border-accent/40 bg-black shadow-lg font-mono text-xs"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="block px-3 py-2 text-text-muted hover:text-foreground hover:bg-accent/10 w-full text-left"
            onClick={() => {
              onDeleteLine(contextMenu.lineId);
              setContextMenu(null);
            }}
          >
            Delete line
          </button>
        </div>
      )}
    </>
  );
}
