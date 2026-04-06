import { NextRequest, NextResponse } from "next/server";
import { getJobSnapshot } from "@/lib/jobs";
import { presignGet, jobKey } from "@/lib/s3";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const { jobId } = params;
  const snap = await getJobSnapshot(jobId);
  if (!snap) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (snap.status !== "complete") {
    return NextResponse.json({ error: `Job is ${snap.status}` }, { status: 409 });
  }
  const base = snap.filename.replace(/\.[^.]+$/, "") || "video";
  const url = await presignGet(jobKey(jobId, "output"), `${base}-aligned.mp4`);
  return NextResponse.redirect(url, 302);
}
