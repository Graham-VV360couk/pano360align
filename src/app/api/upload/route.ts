import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { mkdir, stat } from "fs/promises";
import { createWriteStream } from "fs";
import { join } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { TEMP_DIR, createJob } from "@/lib/jobs";

// Force Node runtime — we need fs streaming, not the Edge runtime.
export const runtime = "nodejs";
// Don't let Next try to cache or precompute anything for an upload route.
export const dynamic = "force-dynamic";
// Big uploads need a long fuse.
export const maxDuration = 3600;

/**
 * Streaming upload.
 *
 * The client sends the raw file as the request body (no multipart) along
 * with an `X-Filename` header. We pipe `req.body` straight to disk via
 * Node streams so memory usage stays flat regardless of file size — the
 * old `req.formData()` + `arrayBuffer()` approach buffered the entire
 * file twice in RAM and OOM'd on multi-GB videos.
 */
export async function POST(req: NextRequest) {
  try {
    if (!req.body) {
      return NextResponse.json({ error: "No request body" }, { status: 400 });
    }

    const filename = req.headers.get("x-filename") || "upload.mp4";
    const ext = filename.split(".").pop() || "mp4";

    const jobId = randomUUID();
    const jobDir = join(TEMP_DIR, jobId);
    await mkdir(jobDir, { recursive: true });
    const inputPath = join(jobDir, `input.${ext}`);

    // Stream the request body to disk.
    // `req.body` is a Web ReadableStream; convert to a Node Readable.
    const nodeReadable = Readable.fromWeb(
      req.body as unknown as import("stream/web").ReadableStream
    );
    const writeStream = createWriteStream(inputPath);
    await pipeline(nodeReadable, writeStream);

    const { size } = await stat(inputPath);
    createJob(jobId, filename, inputPath);

    return NextResponse.json({ jobId, filename, size });
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json(
      { error: "Upload failed: " + (err as Error).message },
      { status: 500 }
    );
  }
}
