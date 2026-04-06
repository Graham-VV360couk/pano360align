# ALIGNMENT.md — Alignment Canvas Spec

## Purpose

Display the user's chosen reference frame as a navigable equirectangular view. The user drags to look around and adjusts roll until a known straight line in the scene appears straight. The resulting yaw / pitch / roll values are the correction to apply to the video.

---

## Relationship to PanoAlign

This component is functionally identical to the PanoAlign alignment canvas. Port the following directly:

- Equirectangular projection / ray casting render loop
- Mouse drag → yaw / pitch
- The `projectHotspot` function (use verbatim — `asin(dx)` not `atan(dx/dz)`)
- Drag convention: drag-up = look up, drag-right = pan right
- Canvas resize on window resize

The only additions specific to this tool:

- **Roll adjustment** (PanoAlign may not have implemented this — see below)
- **Straight-line overlay guide**
- Input is a video frame capture (ImageData from canvas), not a loaded image file

---

## Inputs

The alignment canvas receives a single frame image from the scrubber component via:

```javascript
alignmentCanvas.loadFrame(imageDataURL); // base64 PNG snapshot from video
```

On receiving a new frame, the canvas resets yaw/pitch/roll to 0 and re-renders.

---

## Controls

### Yaw (horizontal rotation)
- Mouse drag left/right
- Keyboard: Arrow Left / Arrow Right
- Range: -180° to +180° (wraps)

### Pitch (vertical rotation)  
- Mouse drag up/down
- Keyboard: Arrow Up / Arrow Down
- Range: -85° to +85° (clamped)

### Roll (rotation around the viewing axis)
- This is the key control for horizon correction
- **UI: A horizontal slider** below the canvas, labelled "Roll"
- Range: -45° to +45° (beyond this is almost certainly wrong)
- Default: 0°
- Keyboard: Q (roll left) / E (roll right), 0.5° per press
- Roll must be applied in the render pipeline as a third rotation matrix

### Roll in the render pipeline

After yaw and pitch rotations, apply roll:

```javascript
// After existing yaw + pitch rotations, add roll:
const rollRad = roll * Math.PI / 180;
const cosR = Math.cos(rollRad), sinR = Math.sin(rollRad);
// Rotate around Z axis (the viewing direction)
let finalX = fx * cosR - fy * sinR;
let finalY = fx * sinR + fy * cosR;
let finalZ = fz;
```

---

## Straight-line overlay guide

An optional visual aid. When enabled, draws a horizontal line across the centre of the canvas at the current pitch level.

- Toggle button: "Show guide line"
- Rendered as a CSS overlay on top of the canvas (not drawn into the canvas pixels)
- Colour: semi-transparent cyan, 1px, full width
- Purpose: user aligns a known horizontal in their scene to this line

A secondary **vertical guide line** (for checking vertical structures like poles, doorframes):
- Same toggle or separate
- Drawn at the centre of the canvas horizontally

---

## Live readout

Displayed below the canvas, updated on every render:

```
YAW    +12.4°     PITCH    -3.1°     ROLL    +0.8°
```

Copy button: copies values as a JSON snippet for debugging:
```json
{ "yaw": 12.4, "pitch": -3.1, "roll": 0.8 }
```

---

## Reset button

Returns yaw, pitch, roll all to 0. Prompts user to confirm if any value is non-zero.

---

## FOV

Fixed at 100° for this tool. The user is aligning, not exploring — a wide FOV makes the geometry easier to judge. Do not expose FOV control.

---

## Performance note

The frame captured from the scrubber will be at the video's native resolution, potentially 5760×2880 or similar for modern 360 cameras. Downsample the captured frame to a maximum of **4096×2048** before loading into the alignment canvas. The alignment maths do not require full resolution and the render loop will be significantly faster.

```javascript
function downsampleFrame(src, maxWidth = 4096) {
  if (src.width <= maxWidth) return src;
  const scale = maxWidth / src.width;
  const oc = document.createElement('canvas');
  oc.width = maxWidth;
  oc.height = Math.round(src.height * scale);
  oc.getContext('2d').drawImage(src, 0, 0, oc.width, oc.height);
  return oc;
}
```
