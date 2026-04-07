"use client";

import { useState, useMemo } from "react";

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 450;
const DEFAULT_FOV = 100;

function buildEmbedHtml(opts: {
  videoUrl: string;
  width: number;
  height: number;
  fov: number;
}): string {
  const id = `pano360-${Math.random().toString(36).slice(2, 10)}`;
  const { videoUrl, width, height, fov } = opts;
  return `<div id="${id}" style="width:${width}px;height:${height}px;background:#000;position:relative;overflow:hidden;"></div>
<script src="https://cdn.jsdelivr.net/npm/three@0.150.1/build/three.min.js"></script>
<script>
(function(){
  var el = document.getElementById("${id}");
  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(${fov}, ${width}/${height}, 0.1, 1000);
  camera.target = new THREE.Vector3(0, 0, 0);
  var renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(${width}, ${height});
  el.appendChild(renderer.domElement);

  var video = document.createElement("video");
  video.src = "${videoUrl}";
  video.crossOrigin = "anonymous";
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.play();

  var texture = new THREE.VideoTexture(video);

  var geometry = new THREE.SphereGeometry(500, 60, 40);
  geometry.scale(-1, 1, 1); // invert so we see the inside
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

export default function EmbedGenerator() {
  const [videoUrl, setVideoUrl] = useState("");
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [fov, setFov] = useState(DEFAULT_FOV);
  const [copied, setCopied] = useState(false);

  const html = useMemo(() => {
    if (!videoUrl) return "";
    return buildEmbedHtml({ videoUrl, width, height, fov });
  }, [videoUrl, width, height, fov]);

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
        <div className="grid grid-cols-3 gap-2">
          <label className="block">
            <span className="block font-mono text-xs text-text-muted mb-1">Width</span>
            <input
              type="number"
              value={width}
              onChange={(e) => setWidth(parseInt(e.target.value) || DEFAULT_WIDTH)}
              min={200}
              max={4000}
              className="w-full bg-black/40 border border-border-subtle rounded px-3 py-2 font-mono text-xs"
            />
          </label>
          <label className="block">
            <span className="block font-mono text-xs text-text-muted mb-1">Height</span>
            <input
              type="number"
              value={height}
              onChange={(e) => setHeight(parseInt(e.target.value) || DEFAULT_HEIGHT)}
              min={200}
              max={4000}
              className="w-full bg-black/40 border border-border-subtle rounded px-3 py-2 font-mono text-xs"
            />
          </label>
          <label className="block">
            <span className="block font-mono text-xs text-text-muted mb-1">Initial FOV</span>
            <input
              type="number"
              value={fov}
              onChange={(e) => setFov(parseInt(e.target.value) || DEFAULT_FOV)}
              min={30}
              max={150}
              className="w-full bg-black/40 border border-border-subtle rounded px-3 py-2 font-mono text-xs"
            />
          </label>
        </div>

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
              Self-contained — paste it into any HTML page.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
