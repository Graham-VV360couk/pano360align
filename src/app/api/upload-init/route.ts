import { NextRequest, NextResponse } from "next/server";
import { createJobForUpload, type AlignmentValues } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { filename, alignment, trimStart } = body as {
      filename?: string;
      alignment?: AlignmentValues;
      trimStart?: number;
    };
    if (!filename || !alignment) {
      return NextResponse.json({ error: "Missing filename or alignment" }, { status: 400 });
    }
    const result = await createJobForUpload(
      filename,
      alignment,
      typeof trimStart === "number" ? trimStart : 0
    );
    return NextResponse.json(result);
  } catch (err) {
    console.error("upload-init error:", err);
    return NextResponse.json(
      { error: "upload-init failed: " + (err as Error).message },
      { status: 500 }
    );
  }
}
