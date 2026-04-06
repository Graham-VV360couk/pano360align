import { NextRequest } from "next/server";

/**
 * TODO: Implement SSE progress endpoint.
 *
 * Returns a Server-Sent Events stream with:
 *   { status: "processing", progress: 34, eta: 120 }
 *   { status: "complete", downloadUrl: "/api/download/{jobId}" }
 *   { status: "failed", error: "..." }
 *
 * Parse FFmpeg stderr for time= progress.
 * See docs/PROCESSING.md for parsing details.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const { jobId } = params;

  // TODO: Look up job, stream SSE progress
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ status: "pending", jobId, message: "Not yet implemented" })}\n\n`)
      );
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
