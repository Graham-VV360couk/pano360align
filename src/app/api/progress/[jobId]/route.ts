import { NextRequest } from "next/server";
import { getJob, snapshot, type JobSnapshot } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const { jobId } = params;
  const job = getJob(jobId);

  const encoder = new TextEncoder();

  if (!job) {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ status: "failed", error: "Job not found" })}\n\n`
          )
        );
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  const stream = new ReadableStream({
    start(controller) {
      const send = (snap: JobSnapshot) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(snap)}\n\n`));
        } catch {}
      };

      // Initial snapshot
      send(snapshot(job));

      const onUpdate = (snap: JobSnapshot) => {
        send(snap);
        if (
          snap.status === "complete" ||
          snap.status === "failed" ||
          snap.status === "expired"
        ) {
          job.events.off("update", onUpdate);
          try {
            controller.close();
          } catch {}
        }
      };
      job.events.on("update", onUpdate);

      // Heartbeat to keep proxies happy
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15000);

      // If the job is already finished by the time we subscribe, close
      if (
        job.status === "complete" ||
        job.status === "failed" ||
        job.status === "expired"
      ) {
        clearInterval(heartbeat);
        job.events.off("update", onUpdate);
        try {
          controller.close();
        } catch {}
      }

      // Cleanup on client disconnect
      const cleanup = () => {
        clearInterval(heartbeat);
        job.events.off("update", onUpdate);
      };
      // @ts-expect-error — non-standard but available on the underlying stream
      controller.signal?.addEventListener?.("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
