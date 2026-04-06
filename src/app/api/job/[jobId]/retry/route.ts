import { NextRequest, NextResponse } from "next/server";
import { retryJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const snap = await retryJob(params.jobId);
  if (!snap) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json({ ok: true, snapshot: snap });
}
