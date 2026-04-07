"use client";

import { useCallback, useRef } from "react";
import type { FileType } from "@/app/page";

interface UploadZoneProps {
  onFileLoaded: (file: File, type: FileType) => void;
  collapsed: boolean;
  onReset: () => void;
  fileName?: string;
  fileSize?: number;
  resetDisabled?: boolean;
}

const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "video/mp4",
  "video/quicktime",
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

export default function UploadZone({ onFileLoaded, collapsed, onReset, fileName, fileSize, resetDisabled }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    const isVideo = file.type.startsWith("video/");
    const isImage = file.type.startsWith("image/");

    if (!isVideo && !isImage) {
      alert("Unsupported file type. Please upload a JPG, PNG, WebP, MP4, or MOV file.");
      return;
    }

    if (!ACCEPTED_TYPES.includes(file.type)) {
      alert("Unsupported file type. Please upload a JPG, PNG, WebP, MP4, or MOV file.");
      return;
    }

    onFileLoaded(file, isVideo ? "video" : "image");
  }, [onFileLoaded]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  if (collapsed) {
    const isLarge = (fileSize ?? 0) > 2 * 1024 * 1024 * 1024;
    const sizeGb = ((fileSize ?? 0) / (1024 * 1024 * 1024)).toFixed(1);
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between border border-border-subtle rounded-lg px-4 py-3">
          <div className="font-mono text-sm text-text-muted">
            {fileName} {fileSize ? `(${formatBytes(fileSize)})` : ""}
          </div>
          <button
            onClick={onReset}
            disabled={resetDisabled}
            title={resetDisabled ? "Wait until the current upload finishes" : undefined}
            className="font-mono text-xs text-accent enabled:hover:underline disabled:opacity-30 disabled:cursor-not-allowed disabled:no-underline"
          >
            Start again
          </button>
        </div>
        {isLarge && (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-4 py-2">
            <p className="font-mono text-[11px] text-yellow-200/80 leading-relaxed">
              ℹ Large file ({sizeGb} GB). Processing will take longer than usual —
              expect tens of minutes or more depending on server load. The page
              must remain open during processing.
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="border-2 border-dashed border-border-subtle rounded-xl p-12 text-center cursor-pointer hover:border-accent/30 transition-colors"
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        onChange={handleChange}
        className="hidden"
      />
      <p className="font-heading text-lg text-text-muted mb-2">
        Drop an image or video here
      </p>
      <p className="font-mono text-xs text-text-muted">
        JPG &middot; PNG &middot; WebP &nbsp;/&nbsp; MP4 &middot; MOV
      </p>
      <p className="font-mono text-[0.65rem] text-text-muted mt-6 max-w-md mx-auto leading-relaxed">
        For static, tripod-mounted 360° cameras only.
        Export your video as a full equirectangular MP4 from your camera app first.
        Do not use reframed, &ldquo;magic window&rdquo;, or rectilinear exports.
      </p>
    </div>
  );
}
