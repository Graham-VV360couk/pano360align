"use client";

import { useEffect, useRef } from "react";
import type { RenderParams } from "@/lib/equirect";
import {
  type ReferenceLine,
  projectSphericalToScreen,
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

export default function LineOverlay({
  width,
  height,
  view,
  lines,
  selectedLineId,
  mode,
}: LineOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
  }, [width, height, view, lines, selectedLineId]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="absolute inset-0 pointer-events-none"
      style={{
        width: "100%",
        height: "100%",
        pointerEvents: mode === "pan" ? "none" : "auto",
        cursor: mode === "pan" ? "default" : "crosshair",
      }}
    />
  );
}
