import { NextRequest, NextResponse } from "next/server";
import { rm } from "fs/promises";
import { dirname } from "path";
import { getJob, updateJob, deleteJob } from "@/lib/jobs";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const { jobId } = params;
  const job = getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  // Kill any running ffmpeg
  if (job.process && !job.process.killed) {
    try {
      job.process.kill("SIGKILL");
    } catch {}
  }

  // Best-effort cleanup of the job dir (input + output)
  try {
    await rm(dirname(job.outputPath), { recursive: true, force: true });
  } catch {}

  updateJob(jobId, { status: "failed", error: "Cancelled by user" });
  deleteJob(jobId);

  return NextResponse.json({ ok: true, jobId });
}
