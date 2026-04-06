import { NextRequest, NextResponse } from "next/server";

/**
 * TODO: Implement FFmpeg processing endpoint.
 *
 * Accepts: { jobId, yaw, pitch, roll }
 * Spawns FFmpeg with v360 filter, reports progress via SSE.
 *
 * FFmpeg command:
 *   ffmpeg -i input.mp4
 *     -vf "v360=e:e:yaw={YAW}:pitch={PITCH}:roll={ROLL}:interp=lanczos"
 *     -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p
 *     -c:a copy -movflags +faststart
 *     -metadata:s:v:0 spherical=true
 *     output.mp4
 *
 * See docs/PROCESSING.md for full spec.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { jobId, yaw, pitch, roll } = body;

  if (!jobId || yaw === undefined || pitch === undefined || roll === undefined) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // TODO: Spawn FFmpeg process, track in jobs Map
  return NextResponse.json({
    jobId,
    status: "queued",
    message: "Processing not yet implemented",
  });
}
