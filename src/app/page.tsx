"use client";

import { useState } from "react";
import Header from "@/components/ui/Header";
import Footer from "@/components/ui/Footer";
import UploadZone from "@/components/upload/UploadZone";
import AlignmentCanvas from "@/components/alignment/AlignmentCanvas";
import StillExport from "@/components/alignment/StillExport";
import VideoSection from "@/components/video/VideoSection";
import JobList from "@/components/jobs/JobList";

export type FileType = "image" | "video" | null;

export interface AlignmentValues {
  yaw: number;
  pitch: number;
  roll: number;
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState<FileType>(null);
  const [frameDataURL, setFrameDataURL] = useState<string | null>(null);
  const [alignment, setAlignment] = useState<AlignmentValues>({ yaw: 0, pitch: 0, roll: 0 });
  const [fov, setFov] = useState(100);

  function handleFileLoaded(f: File, type: FileType) {
    setFile(f);
    setFileType(type);
    setAlignment({ yaw: 0, pitch: 0, roll: 0 });
    setFrameDataURL(null);

    if (type === "image") {
      const url = URL.createObjectURL(f);
      setFrameDataURL(url);
    }
  }

  function handleFrameSelected(dataURL: string) {
    setFrameDataURL(dataURL);
    setAlignment({ yaw: 0, pitch: 0, roll: 0 });
  }

  function handleReset() {
    setFile(null);
    setFileType(null);
    setFrameDataURL(null);
    setAlignment({ yaw: 0, pitch: 0, roll: 0 });
    setFov(100);
  }

  return (
    <main className="min-h-screen flex flex-col">
      <Header />

      <div className="flex-1 w-full max-w-6xl mx-auto px-4 py-6 space-y-6">
        <JobList />
        {/* Upload zone — collapses once file is loaded */}
        <UploadZone
          onFileLoaded={handleFileLoaded}
          collapsed={file !== null}
          onReset={handleReset}
          fileName={file?.name}
          fileSize={file?.size}
        />

        {/* Alignment canvas — shown once a frame is available */}
        {frameDataURL && (
          <AlignmentCanvas
            frameDataURL={frameDataURL}
            alignment={alignment}
            onAlignmentChange={setAlignment}
            fov={fov}
            onFovChange={setFov}
          />
        )}

        {/* Still image export — shown for images only */}
        {fileType === "image" && frameDataURL && (
          <StillExport
            frameDataURL={frameDataURL}
            alignment={alignment}
            fileName={file?.name ?? "image"}
          />
        )}

        {/* Video section — shown for video only */}
        {fileType === "video" && file && (
          <VideoSection
            file={file}
            alignment={alignment}
            fov={fov}
            onFrameSelected={handleFrameSelected}
            onJobQueued={handleReset}
          />
        )}
      </div>

      <Footer />
    </main>
  );
}
