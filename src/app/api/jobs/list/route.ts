import { NextRequest, NextResponse } from "next/server";
import { listJobSnapshots } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { ids } = (await req.json()) as { ids?: string[] };
    if (!Array.isArray(ids)) {
      return NextResponse.json({ error: "ids must be an array" }, { status: 400 });
    }
    const snaps = await listJobSnapshots(ids);
    return NextResponse.json(snaps);
  } catch (err) {
    return NextResponse.json(
      { error: "jobs/list failed: " + (err as Error).message },
      { status: 500 }
    );
  }
}
