import { NextRequest, NextResponse } from "next/server";

/**
 * TODO: Implement download endpoint.
 *
 * Streams the corrected output file to the client.
 * Headers: Content-Type: video/mp4, Content-Disposition: attachment
 * Filename: {original-name}-aligned.mp4
 *
 * See docs/INFRASTRUCTURE.md for spec.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const { jobId } = params;

  // TODO: Look up job, stream output file
  return NextResponse.json(
    { error: "Download not yet implemented", jobId },
    { status: 501 }
  );
}
