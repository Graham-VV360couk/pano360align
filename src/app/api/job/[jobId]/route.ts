import { NextRequest, NextResponse } from "next/server";
import { deleteJobFully } from "@/lib/jobs";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  await deleteJobFully(params.jobId);
  return NextResponse.json({ ok: true, jobId: params.jobId });
}
