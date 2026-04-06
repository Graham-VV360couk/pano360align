import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { getJob } from "@/lib/jobs";
import { Readable } from "stream";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const { jobId } = params;
  const job = getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (job.status !== "complete") {
    return NextResponse.json(
      { error: `Job is ${job.status}` },
      { status: 409 }
    );
  }

  let size: number;
  try {
    const s = await stat(job.outputPath);
    size = s.size;
  } catch {
    return NextResponse.json({ error: "Output file missing" }, { status: 410 });
  }

  const base = job.filename.replace(/\.[^.]+$/, "") || "video";
  const downloadName = `${base}-aligned.mp4`;

  const nodeStream = createReadStream(job.outputPath);
  // Convert Node Readable to Web ReadableStream
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;

  return new Response(webStream, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="${downloadName}"`,
      "Cache-Control": "no-store",
    },
  });
}
