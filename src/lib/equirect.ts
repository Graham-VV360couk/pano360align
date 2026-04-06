/**
 * Equirectangular ray-casting renderer.
 * Ported from EquiRecover (src/viewer/renderer.js) with the addition of a
 * roll axis (rotation in the screen plane, applied before yaw/pitch).
 *
 * Convention (matches EquiRecover):
 * - Positive yaw   = look right
 * - Positive pitch = look up
 * - Positive roll  = horizon tilts clockwise (slider right)
 *
 * FOV is fixed at 100° horizontal for Pano360Align.
 */

export interface PanoramaPixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface RenderParams {
  yaw: number;   // degrees
  pitch: number; // degrees
  roll: number;  // degrees
  fov: number;   // degrees, horizontal
}

/**
 * Decode an HTMLImageElement into a flat RGBA pixel buffer, downsampled
 * so the longest edge is no larger than `maxWidth`.
 */
export function imageToPixels(img: HTMLImageElement, maxWidth = 4096): PanoramaPixels {
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  const scale = srcW > maxWidth ? maxWidth / srcW : 1;
  const w = Math.round(srcW * scale);
  const h = Math.round(srcH * scale);

  const oc = document.createElement("canvas");
  oc.width = w;
  oc.height = h;
  const octx = oc.getContext("2d", { willReadFrequently: true })!;
  octx.drawImage(img, 0, 0, w, h);
  const data = octx.getImageData(0, 0, w, h).data;
  return { data, width: w, height: h };
}

/**
 * Render an equirectangular projection into the destination ImageData.
 * Roll is applied as a rotation of the local ray in the screen plane,
 * then yaw (Y axis), then pitch (X axis), matching EquiRecover's
 * `correctionPreview` -> yaw -> pitch order.
 */
export function renderEquirect(
  dst: ImageData,
  src: PanoramaPixels,
  params: RenderParams
): void {
  const W = dst.width;
  const H = dst.height;
  const out = dst.data;
  const px = src.data;
  const pW = src.width;
  const pH = src.height;

  const fovRad = (params.fov * Math.PI) / 180;
  const yawRad = (params.yaw * Math.PI) / 180;
  const pitchRad = (params.pitch * Math.PI) / 180;
  const rollRad = (params.roll * Math.PI) / 180;

  const cosY = Math.cos(yawRad);
  const sinY = Math.sin(yawRad);
  const cosP = Math.cos(pitchRad);
  const sinP = Math.sin(pitchRad);
  const cosR = Math.cos(rollRad);
  const sinR = Math.sin(rollRad);

  const halfFovH = fovRad / 2;
  const halfFovV = (fovRad * H) / W / 2;

  for (let py = 0; py < H; py++) {
    const angV = halfFovV - (py / H) * 2 * halfFovV;
    const sinAngV = Math.sin(angV);
    for (let pxi = 0; pxi < W; pxi++) {
      const angH = -halfFovH + (pxi / W) * 2 * halfFovH;
      const cosAngH = Math.cos(angH);

      // Local ray direction
      let dx = Math.sin(angH);
      let dy = sinAngV * cosAngH;
      const dz = cosAngH * Math.cos(angV);

      // Roll: rotate ray in the screen plane (around Z, the view axis).
      // Positive roll => world appears to rotate clockwise on screen.
      const rdx = dx * cosR - dy * sinR;
      const rdy = dx * sinR + dy * cosR;
      dx = rdx;
      dy = rdy;

      // Yaw (around Y axis)
      const rx = dx * cosY + dz * sinY;
      const ry = dy;
      const rz = -dx * sinY + dz * cosY;

      // Pitch (around X axis)
      const fx = rx;
      const fy = ry * cosP - rz * sinP;
      const fz = ry * sinP + rz * cosP;

      // Equirectangular UV
      const lat = Math.asin(Math.max(-1, Math.min(1, fy)));
      const lon = Math.atan2(fx, fz);

      let u = (lon / (2 * Math.PI) + 0.5) % 1;
      if (u < 0) u += 1;
      let v = 0.5 - lat / Math.PI;
      if (v < 0) v = 0;
      else if (v > 0.9999) v = 0.9999;

      const si = (((v * pH) | 0) * pW + ((u * pW) | 0)) * 4;
      const di = (py * W + pxi) * 4;
      out[di] = px[si];
      out[di + 1] = px[si + 1];
      out[di + 2] = px[si + 2];
      out[di + 3] = 255;
    }
  }
}

/**
 * Render a fully-corrected equirectangular image at the source resolution.
 * Used by the still export: produces a new equirect where the chosen
 * yaw/pitch/roll have been baked in (output is still 2:1 equirect).
 */
export function renderCorrectedEquirect(
  src: PanoramaPixels,
  params: Pick<RenderParams, "yaw" | "pitch" | "roll">
): ImageData {
  const W = src.width;
  const H = src.height;
  const out = new ImageData(W, H);
  const dst = out.data;
  const px = src.data;

  const yawRad = (params.yaw * Math.PI) / 180;
  const pitchRad = (params.pitch * Math.PI) / 180;
  const rollRad = (params.roll * Math.PI) / 180;
  const cosY = Math.cos(yawRad), sinY = Math.sin(yawRad);
  const cosP = Math.cos(pitchRad), sinP = Math.sin(pitchRad);
  const cosR = Math.cos(rollRad), sinR = Math.sin(rollRad);

  for (let y = 0; y < H; y++) {
    const lat = (0.5 - y / H) * Math.PI;
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    for (let x = 0; x < W; x++) {
      const lon = (x / W - 0.5) * 2 * Math.PI;
      // Output ray
      let dx = cosLat * Math.sin(lon);
      let dy = sinLat;
      let dz = cosLat * Math.cos(lon);

      // Inverse pitch
      const ry1 = dy * cosP + dz * sinP;
      const rz1 = -dy * sinP + dz * cosP;
      dy = ry1;
      dz = rz1;

      // Inverse yaw
      const rx2 = dx * cosY - dz * sinY;
      const rz2 = dx * sinY + dz * cosY;
      dx = rx2;
      dz = rz2;

      // Inverse roll
      const rdx = dx * cosR + dy * sinR;
      const rdy = -dx * sinR + dy * cosR;
      dx = rdx;
      dy = rdy;

      const sLat = Math.asin(Math.max(-1, Math.min(1, dy)));
      const sLon = Math.atan2(dx, dz);
      let u = (sLon / (2 * Math.PI) + 0.5) % 1;
      if (u < 0) u += 1;
      let v = 0.5 - sLat / Math.PI;
      if (v < 0) v = 0;
      else if (v > 0.9999) v = 0.9999;

      const si = (((v * H) | 0) * W + ((u * W) | 0)) * 4;
      const di = (y * W + x) * 4;
      dst[di] = px[si];
      dst[di + 1] = px[si + 1];
      dst[di + 2] = px[si + 2];
      dst[di + 3] = 255;
    }
  }
  return out;
}
