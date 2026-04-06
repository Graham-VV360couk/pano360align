# Line Tool — Design

**Date:** 2026-04-06
**Status:** Approved, ready for implementation plan
**Scope:** New feature for `AlignmentCanvas` in Pano360Align

---

## Purpose

Let the user roll-correct a 360° panorama by drawing reference lines on
features they know to be horizontal or vertical in the real world. Multiple
lines accumulate; their derived rolls are averaged. The result feeds straight
into the existing `roll` value of the alignment state.

The bar is "good enough for the human eye" — no statistical analysis,
confidence ratings, or perpendicularity warnings.

---

## Math

Ported verbatim from `EquiRecover/src/alignment/compute.js`, simplified.

For each committed line, given the screen-space angle measured at draw time:

- **Horizontal line** — normalise the angle so a line drawn left-to-right
  and right-to-left both yield the same canonical value, then:
  ```
  derivedRoll = -angle
  ```
- **Vertical line** — normalise so top-to-bottom and bottom-to-top yield the
  same canonical value (near −90°), then:
  ```
  derivedRoll = -(angle + 90)
  ```

Final roll = arithmetic mean of every line's `derivedRoll`.

**Dropped from EquiRecover:**
- Front/rear zone separation (dual-fisheye stitch analysis — irrelevant).
- Confidence rating (`HIGH` / `MEDIUM` / `LOW` based on line count).
- Perpendicularity warnings between H and V lines.
- Front/rear divergence warnings.
- Standard-deviation outlier warnings.

The screen angle is measured **at the moment of commit, in the current
projected view**. It is then frozen for the lifetime of the line. Subsequent
panning does not change a line's contributed roll.

---

## Storage model

Each line lives in **spherical (world) coordinates** so it sticks to the
underlying scene as the user pans:

```ts
interface ReferenceLine {
  id: number;
  orientation: "horizontal" | "vertical";
  // Endpoints in world space
  a: { yaw: number; pitch: number };
  b: { yaw: number; pitch: number };
  // Roll value this line contributes — frozen at draw time
  derivedRoll: number;
}
```

On commit:
1. The two screen click points are converted to world `(yaw, pitch)` via
   `screenToSpherical` (already ported in spirit from EquiRecover).
2. The screen-space angle of the line at that moment is computed.
3. `derivedRoll` is calculated from the angle and stored.
4. The line is added to the list.

---

## Rendering

A transparent overlay canvas is stacked above the main alignment canvas.
On every render of the main canvas, the overlay redraws all lines:

1. For each line, project both endpoints back to screen via a new
   `projectSphericalToScreen` helper (the forward direction of
   `screenToSpherical`).
2. If **either** endpoint is behind the camera or off-screen, hide that line
   for this frame. It reappears when the user pans the area back into view.
3. Draw the visible lines.

**Visual treatment:**

| Element | Style |
|---|---|
| Horizontal line | Solid cyan (`#00e5ff`), 2 px |
| Vertical line | Dashed cyan (`#00e5ff`), 2 px, dash `[8, 6]` |
| Endpoints | Filled cyan circle, radius 6 px, 70% alpha fill, full-alpha stroke |
| Label | Near midpoint, e.g. `H · −3.2°` or `V · +0.4°` — shows the **contributed roll**, not the raw screen angle, since that's the meaningful number for the user |
| Selected line (for delete) | Add a 3 px outer glow / brighter stroke |

---

## Modes & interaction

A small toolbar above the existing roll slider:

```
[ Pan ]  [ H Line ]  [ V Line ]
```

The active mode button is highlighted in cyan; the others are muted.

- **Pan** (default) — drag-to-yaw/pitch behaviour, unchanged from current.
- **H Line** — drag to draw a horizontal reference. On `mouseup`:
  - If the drag is shorter than 10 px, cancel the line.
  - Otherwise commit the line, recompute the average, push the new roll
    into `onAlignmentChange`, and re-render.
  - Mode stays sticky — user can immediately draw another line.
- **V Line** — same as H Line but for vertical references.

Mode is exited by clicking **Pan** explicitly. There is no auto-revert.

Minimum line length: **10 px**, matching EquiRecover.

No keyboard modifier shortcuts in v1.

---

## Line list

Below the controls bar:

```
Reference lines (3)                          Clear all
─────────────────────────────────────────
H   −3.2°    [×]
V   +0.4°    [×]
H   −2.9°    [×]
─────────────────────────────────────────
Average roll: −1.9°
```

- Each row shows orientation, contributed roll, and an `×` delete button.
- `×` removes the line and recomputes the average; the canvas re-renders.
- **Clear all** wipes every line in one action.
- The list is hidden when there are zero lines.

---

## Deleting a line

Three paths, all equivalent:

1. **From the list:** click `×` next to the line.
2. **Right-click on the canvas:** if the click hits a drawn line (within
   ~6 px of the line segment), show a small context menu with **Delete**.
3. **Select + Delete key:** click on a drawn line on the canvas to select
   it (visual highlight), then press the **Delete** key to remove it.

Hit-testing uses standard point-to-segment distance against the
**currently projected** screen positions of the line endpoints.

---

## Lifecycle — when lines clear

| Event | Lines cleared? |
|---|---|
| New frame selected from video | **Yes** |
| Reset button (existing) | **Yes** |
| Clear all button in list | **Yes** |
| Single × delete | Just that line |
| Pan / drag | No |
| Roll slider tweak | No |
| Yaw / pitch keyboard nudge | No |
| Switching modes | No |

---

## Integration with existing alignment state

The line tool only writes to `roll`. It calls the same `onAlignmentChange`
the existing slider and drag already use, with `{ ...alignment, roll: avg }`.

If the user manually drags the roll slider after drawing lines, the lines
remain visible and the list remains shown — the slider value is now
overriding the line average. We do **not** auto-snap back. The user can
clear the lines when they want to commit to the manual value, or draw
another line which will recompute and override the slider again.

---

## File layout

```
src/
├── lib/
│   └── lineMath.ts           ← computeRoll, projectSphericalToScreen,
│                                hit-testing, angle normalisation
└── components/
    └── alignment/
        ├── AlignmentCanvas.tsx   ← MODIFIED: hosts mode + lines state,
        │                            renders LineOverlay and LineList
        ├── LineOverlay.tsx       ← NEW: overlay canvas, drawing logic,
        │                            click/right-click hit detection
        └── LineList.tsx          ← NEW: the line list UI
```

`AlignmentCanvas.tsx` owns:
- `mode: "pan" | "h-line" | "v-line"`
- `lines: ReferenceLine[]`
- `selectedLineId: number | null`
- `nextLineId: number`

It re-runs the average and calls `onAlignmentChange` whenever `lines`
changes (add or remove).

---

## Out of scope (explicit)

- Front/rear zones, dual-fisheye stitch warnings, confidence ratings,
  outlier detection — none of this is needed for "good enough for the eye".
- Keyboard modifier shortcuts (Shift/Alt to draw without mode switching) —
  can add later if discoverability proves insufficient.
- Two-line full 3-axis gravity solver — drag handles yaw/pitch perfectly
  well. If line-based pitch/yaw correction ever becomes desirable, it
  becomes a separate Phase 2 mode.
- Persisting lines across page reloads.
- Undo/redo history.
