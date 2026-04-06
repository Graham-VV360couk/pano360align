import { NextRequest, NextResponse } from "next/server";

/**
 * TODO: Implement job cancellation endpoint.
 *
 * Kills the running FFmpeg process and cleans up temp files.
 * See docs/INFRASTRUCTURE.md for spec.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const { jobId } = params;

  // TODO: Look up job, kill process, clean up files
  return NextResponse.json(
    { error: "Job cancellation not yet implemented", jobId },
    { status: 501 }
  );
}
