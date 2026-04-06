import { NextRequest, NextResponse } from "next/server";
import { markUploadComplete } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { jobId } = (await req.json()) as { jobId?: string };
    if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
    const snap = await markUploadComplete(jobId);
    if (!snap) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    return NextResponse.json({ ok: true, snapshot: snap });
  } catch (err) {
    console.error("upload-complete error:", err);
    return NextResponse.json(
      { error: "upload-complete failed: " + (err as Error).message },
      { status: 500 }
    );
  }
}
