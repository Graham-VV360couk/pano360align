"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { renderEquirect, type PanoramaPixels } from "@/lib/equirect";

const DEFAULT_FOV = 100;
const PREVIEW_W = 640;
const PREVIEW_H = 360;

type LengthUnit = "px" | "%" | "vw" | "vh" | "em";

interface Dimension {
  value: number;
  unit: LengthUnit;
}

type StylePreset = "fixed" | "fullwidth" | "boxed" | "fullscreen";

const STYLE_PRESETS: Array<{ id: StylePreset; label: string; description: string }> = [
  { id: "fixed", label: "Fixed", description: "Exact pixel size" },
  { id: "fullwidth", label: "Full width", description: "100% of parent, 16:9 ratio" },
  { id: "boxed", label: "Boxed", description: "Centered, max 1200px, 16:9 ratio" },
  { id: "fullscreen", label: "Full screen", description: "100vw × 100vh" },
];

function buildContainerCss(
  preset: StylePreset,
  width: Dimension,
  height: Dimension
): { css: string; numericW: number; numericH: number } {
  // numericW and numericH are used by the embedded three.js script to set
  // the renderer's drawing buffer size. For non-pixel containers we estimate
  // a reasonable buffer size and rely on a ResizeObserver in the embed to
  // adapt at runtime.
  switch (preset) {
    case "fullwidth":
      return {
        css: "width:100%;aspect-ratio:16/9;background:#000;position:relative;overflow:hidden;",
        numericW: 1280,
        numericH: 720,
      };
    case "boxed":
      return {
        css: "width:100%;max-width:1200px;margin:0 auto;aspect-ratio:16/9;background:#000;position:relative;overflow:hidden;",
        numericW: 1200,
        numericH: 675,
      };
    case "fullscreen":
      return {
        css: "width:100vw;height:100vh;background:#000;position:relative;overflow:hidden;",
        numericW: 1920,
        numericH: 1080,
      };
    case "fixed":
    default:
      return {
        css: `width:${width.value}${width.unit};height:${height.value}${height.unit};background:#000;position:relative;overflow:hidden;`,
        numericW: width.unit === "px" ? width.value : 1280,
        numericH: height.unit === "px" ? height.value : 720,
      };
  }
}

function buildEmbedHtml(opts: {
  videoUrl: string;
  preset: StylePreset;
  width: Dimension;
  height: Dimension;
  fov: number;
}): string {
  const id = `pano360-${Math.random().toString(36).slice(2, 10)}`;
  const { videoUrl, preset, width, height, fov } = opts;
  const { css, numericW, numericH } = buildContainerCss(preset, width, height);

  return `<div id="${id}" style="${css}"></div>
<script src="https://cdn.jsdelivr.net/npm/three@0.150.1/build/three.min.js"></script>
<script>
(function(){
  var el = document.getElementById("${id}");
  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(${fov}, ${numericW}/${numericH}, 0.1, 1000);
  camera.target = new THREE.Vector3(0, 0, 0);
  var renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(el.clientWidth || ${numericW}, el.clientHeight || ${numericH});
  el.appendChild(renderer.domElement);

  // Adapt to container size changes (responsive layouts)
  var ro = new ResizeObserver(function(){
    var w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
  ro.observe(el);

  var video = document.createElement("video");
  video.src = "${videoUrl}";
  video.crossOrigin = "anonymous";
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.play();

  var texture = new THREE.VideoTexture(video);
  var geometry = new THREE.SphereGeometry(500, 60, 40);
  geometry.scale(-1, 1, 1);
  var material = new THREE.MeshBasicMaterial({ map: texture });
  var sphere = new THREE.Mesh(geometry, material);
  scene.add(sphere);

  var lon = 0, lat = 0, isDragging = false, lastX = 0, lastY = 0;
  el.addEventListener("mousedown", function(e){ isDragging = true; lastX = e.clientX; lastY = e.clientY; });
  window.addEventListener("mouseup", function(){ isDragging = false; });
  window.addEventListener("mousemove", function(e){
    if (!isDragging) return;
    lon -= (e.clientX - lastX) * 0.1;
    lat += (e.clientY - lastY) * 0.1;
    lat = Math.max(-85, Math.min(85, lat));
    lastX = e.clientX; lastY = e.clientY;
  });
  el.addEventListener("touchstart", function(e){ isDragging = true; lastX = e.touches[0].clientX; lastY = e.touches[0].clientY; }, { passive: true });
  el.addEventListener("touchend", function(){ isDragging = false; });
  el.addEventListener("touchmove", function(e){
    if (!isDragging) return;
    lon -= (e.touches[0].clientX - lastX) * 0.1;
    lat += (e.touches[0].clientY - lastY) * 0.1;
    lat = Math.max(-85, Math.min(85, lat));
    lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
  }, { passive: true });

  function animate() {
    requestAnimationFrame(animate);
    var phi = THREE.MathUtils.degToRad(90 - lat);
    var theta = THREE.MathUtils.degToRad(lon);
    camera.target.x = 500 * Math.sin(phi) * Math.cos(theta);
    camera.target.y = 500 * Math.cos(phi);
    camera.target.z = 500 * Math.sin(phi) * Math.sin(theta);
    camera.lookAt(camera.target);
    renderer.render(scene, camera);
  }
  animate();
})();
</script>`;
}

/**
 * Pull a single frame from a video URL into a flat RGBA pixel buffer.
 * Falls back to throwing on CORS errors so the caller can show a friendly
 * "preview unavailable" message.
 */
async function videoUrlToPanoramaPixels(url: string): Promise<PanoramaPixels> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;

    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      video.src = "";
    };

    const onError = () => {
      cleanup();
      reject(new Error("Could not load video — check the URL and CORS headers"));
    };

    const onSeeked = () => {
      try {
        const w = video.videoWidth || 1280;
        const h = video.videoHeight || 640;
        const oc = document.createElement("canvas");
        oc.width = w;
        oc.height = h;
        const ctx = oc.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(video, 0, 0, w, h);
        // This will throw if the canvas is tainted by a CORS-less video.
        const data = ctx.getImageData(0, 0, w, h).data;
        cleanup();
        resolve({ data, width: w, height: h });
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    video.addEventListener("error", onError);
    video.addEventListener("loadedmetadata", () => {
      // Seek to a tiny offset so we don't grab a black frame
      try {
        video.currentTime = 0.5;
      } catch {
        // Some browsers reject pre-load seeks; just play+seek
        video.play().catch(() => {});
      }
    });
    video.addEventListener("seeked", onSeeked, { once: true });
  });
}

export default function EmbedGenerator() {
  const [videoUrl, setVideoUrl] = useState("");
  const [preset, setPreset] = useState<StylePreset>("fixed");
  const [width, setWidth] = useState<Dimension>({ value: 800, unit: "px" });
  const [height, setHeight] = useState<Dimension>({ value: 450, unit: "px" });
  const [fov, setFov] = useState(DEFAULT_FOV);
  const [copied, setCopied] = useState(false);

  // Live preview state
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const pixelsRef = useRef<PanoramaPixels | null>(null);
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [previewError, setPreviewError] = useState<string | null>(null);
  // Drag state for the preview — these are NOT persisted into the embed.
  // They just let the user look around the preview canvas.
  const [previewYaw, setPreviewYaw] = useState(0);
  const [previewPitch, setPreviewPitch] = useState(0);
  const draggingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });

  // Load a frame from the video URL whenever it changes
  useEffect(() => {
    if (!videoUrl) {
      pixelsRef.current = null;
      setPreviewState("idle");
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    setPreviewState("loading");
    setPreviewError(null);
    videoUrlToPanoramaPixels(videoUrl)
      .then((px) => {
        if (cancelled) return;
        pixelsRef.current = px;
        setPreviewState("ready");
        setPreviewYaw(0);
        setPreviewPitch(0);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        pixelsRef.current = null;
        setPreviewError(err.message);
        setPreviewState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [videoUrl]);

  // Render the preview whenever inputs change
  const drawPreview = useCallback(() => {
    const canvas = previewCanvasRef.current;
    const pixels = pixelsRef.current;
    if (!canvas || !pixels) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(canvas.width, canvas.height);
    renderEquirect(img, pixels, {
      yaw: previewYaw,
      pitch: previewPitch,
      roll: 0,
      fov,
    });
    ctx.putImageData(img, 0, 0);
  }, [fov, previewYaw, previewPitch]);

  useEffect(() => {
    if (previewState === "ready") drawPreview();
  }, [previewState, drawPreview]);

  // Drag handlers for the preview canvas
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const onDown = (e: MouseEvent) => {
      draggingRef.current = true;
      lastPosRef.current = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const dx = e.clientX - lastPosRef.current.x;
      const dy = e.clientY - lastPosRef.current.y;
      lastPosRef.current = { x: e.clientX, y: e.clientY };
      const sensitivity = (fov / canvas.width) * 0.6;
      setPreviewYaw((y) => y - dx * sensitivity);
      setPreviewPitch((p) =>
        Math.max(-85, Math.min(85, p - dy * sensitivity))
      );
    };
    const onUp = () => {
      draggingRef.current = false;
    };
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [fov]);

  const html = useMemo(() => {
    if (!videoUrl) return "";
    return buildEmbedHtml({ videoUrl, preset, width, height, fov });
  }, [videoUrl, preset, width, height, fov]);

  const copy = async () => {
    if (!html) return;
    try {
      await navigator.clipboard.writeText(html);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <section className="border border-border-subtle rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border-subtle">
        <h2 className="font-heading text-sm font-medium">EMBED CODE</h2>
      </div>
      <div className="p-4 space-y-3">
        <p className="font-mono text-xs text-text-muted leading-relaxed">
          Once you&apos;ve uploaded your corrected video to your own hosting,
          paste the URL here and grab an embed snippet for your website.
        </p>

        <label className="block">
          <span className="block font-mono text-xs text-text-muted mb-1">Video URL</span>
          <input
            type="url"
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            placeholder="https://example.com/my-corrected-video.mp4"
            className="w-full bg-black/40 border border-border-subtle rounded px-3 py-2 font-mono text-xs"
          />
        </label>

        {/* Preview canvas */}
        {videoUrl && (
          <div className="space-y-2">
            <div className="relative bg-black/50 rounded overflow-hidden">
              <canvas
                ref={previewCanvasRef}
                width={PREVIEW_W}
                height={PREVIEW_H}
                className="block w-full cursor-grab active:cursor-grabbing"
                style={{ aspectRatio: `${PREVIEW_W} / ${PREVIEW_H}` }}
              />
              {previewState === "loading" && (
                <div className="absolute inset-0 flex items-center justify-center font-mono text-xs text-text-muted">
                  Loading frame from video…
                </div>
              )}
              {previewState === "error" && (
                <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
                  <p className="font-mono text-xs text-yellow-300/80 leading-relaxed">
                    Preview unavailable: {previewError}.
                    <br />
                    <span className="text-text-muted">
                      The embed code itself will still work — this just means
                      we can&apos;t render it here. Make sure your video host
                      sends an <code>Access-Control-Allow-Origin</code> header.
                    </span>
                  </p>
                </div>
              )}
              {previewState === "idle" && (
                <div className="absolute inset-0 flex items-center justify-center font-mono text-xs text-text-muted">
                  Paste a video URL to see a live preview
                </div>
              )}
            </div>
            {previewState === "ready" && (
              <p className="font-mono text-[10px] text-text-muted/70">
                Drag to look around. The slider below sets the embed&apos;s
                initial FOV.
              </p>
            )}
          </div>
        )}

        {/* FOV slider */}
        <div className="flex items-center gap-4">
          <label className="font-mono text-xs text-text-muted w-12">FOV</label>
          <input
            type="range"
            min={30}
            max={150}
            step={1}
            value={fov}
            onChange={(e) => setFov(parseInt(e.target.value))}
            className="flex-1"
          />
          <span className="font-mono text-xs text-accent w-16 text-right">
            {fov}°
          </span>
        </div>

        {/* Style preset */}
        <div className="space-y-2">
          <span className="block font-mono text-xs text-text-muted">Layout</span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {STYLE_PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPreset(p.id)}
                className={`px-3 py-2 rounded font-mono text-xs border transition-colors text-left ${
                  preset === p.id
                    ? "border-accent text-accent bg-accent/10"
                    : "border-border-subtle text-text-muted hover:border-accent/30"
                }`}
                title={p.description}
              >
                <div className="font-medium">{p.label}</div>
                <div className="text-[10px] opacity-70 leading-tight mt-0.5">
                  {p.description}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Width / height — only shown for the Fixed preset */}
        {preset === "fixed" && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="block font-mono text-xs text-text-muted mb-1">Width</span>
              <div className="flex gap-1">
                <input
                  type="number"
                  value={width.value}
                  onChange={(e) =>
                    setWidth({ ...width, value: parseFloat(e.target.value) || 0 })
                  }
                  min={1}
                  max={4000}
                  className="flex-1 bg-black/40 border border-border-subtle rounded px-3 py-2 font-mono text-xs"
                />
                <select
                  value={width.unit}
                  onChange={(e) =>
                    setWidth({ ...width, unit: e.target.value as LengthUnit })
                  }
                  className="bg-black/40 border border-border-subtle rounded px-2 py-2 font-mono text-xs"
                >
                  <option value="px">px</option>
                  <option value="%">%</option>
                  <option value="vw">vw</option>
                  <option value="em">em</option>
                </select>
              </div>
            </div>
            <div>
              <span className="block font-mono text-xs text-text-muted mb-1">Height</span>
              <div className="flex gap-1">
                <input
                  type="number"
                  value={height.value}
                  onChange={(e) =>
                    setHeight({ ...height, value: parseFloat(e.target.value) || 0 })
                  }
                  min={1}
                  max={4000}
                  className="flex-1 bg-black/40 border border-border-subtle rounded px-3 py-2 font-mono text-xs"
                />
                <select
                  value={height.unit}
                  onChange={(e) =>
                    setHeight({ ...height, unit: e.target.value as LengthUnit })
                  }
                  className="bg-black/40 border border-border-subtle rounded px-2 py-2 font-mono text-xs"
                >
                  <option value="px">px</option>
                  <option value="%">%</option>
                  <option value="vh">vh</option>
                  <option value="em">em</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {html && (
          <>
            <pre className="bg-black/50 border border-border-subtle rounded p-3 font-mono text-[10px] text-text-muted overflow-auto max-h-64 leading-relaxed">
{html}
            </pre>
            <button
              onClick={copy}
              className="w-full py-2 rounded bg-accent/10 border border-accent/30 text-accent font-heading text-xs font-medium hover:bg-accent/20 transition-colors"
            >
              {copied ? "✓ Copied" : "📋 Copy to clipboard"}
            </button>
            <p className="font-mono text-[10px] text-text-muted/70">
              Loads three.js from a CDN. Drag to look around. Touch on mobile.
              Adapts to container size at runtime — paste it into any HTML page.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
