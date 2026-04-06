import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { TEMP_DIR, createJob } from "@/lib/jobs";

const MAX_SIZE = parseInt(process.env.MAX_UPLOAD_SIZE_GB || "8") * 1024 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File too large" }, { status: 413 });
    }

    const jobId = randomUUID();
    const jobDir = join(TEMP_DIR, jobId);
    await mkdir(jobDir, { recursive: true });

    const ext = file.name.split(".").pop() || "mp4";
    const inputPath = join(jobDir, `input.${ext}`);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(inputPath, buffer);

    createJob(jobId, file.name, inputPath);

    return NextResponse.json({
      jobId,
      filename: file.name,
      size: file.size,
    });
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
