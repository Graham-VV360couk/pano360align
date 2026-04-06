"use client";

import type { ReferenceLine } from "@/lib/lineMath";

interface LineListProps {
  lines: ReferenceLine[];
  averageRoll: number;
  onDelete: (id: number) => void;
  onClearAll: () => void;
}

export default function LineList({
  lines,
  averageRoll,
  onDelete,
  onClearAll,
}: LineListProps) {
  if (lines.length === 0) return null;

  const fmt = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}°`;

  return (
    <div className="border-t border-border-subtle px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-xs text-text-muted">
          Reference lines ({lines.length})
        </h3>
        <button
          onClick={onClearAll}
          className="font-mono text-xs text-text-muted hover:text-foreground transition-colors"
        >
          Clear all
        </button>
      </div>
      <ul className="space-y-1">
        {lines.map((line) => (
          <li
            key={line.id}
            className="flex items-center justify-between font-mono text-xs"
          >
            <span className="text-text-muted">
              <span className="text-accent">
                {line.orientation === "horizontal" ? "H" : "V"}
              </span>
              <span className="ml-3">{fmt(line.derivedRoll)}</span>
            </span>
            <button
              onClick={() => onDelete(line.id)}
              className="text-text-muted hover:text-foreground px-2"
              aria-label={`Delete line ${line.id}`}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="font-mono text-xs text-accent pt-1">
        Average roll: {fmt(averageRoll)}
      </div>
    </div>
  );
}
