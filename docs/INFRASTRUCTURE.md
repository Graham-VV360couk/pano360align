# INFRASTRUCTURE.md — Docker / Coolify / API Spec

## Deployment target

Coolify instance — same infrastructure as existing GeekyBee tools. Docker container. Single service.

---

## Docker setup

### Base image

```dockerfile
FROM node:20-alpine

# Install FFmpeg
RUN apk add --no-cache ffmpeg

# Verify FFmpeg has v360 filter support
RUN ffmpeg -filters 2>/dev/null | grep v360

WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .

# Temp directory for job files
RUN mkdir -p /tmp/360aligner

EXPOSE 3000
CMD ["node", "server.js"]
```

### Important: FFmpeg build requirements

The `v360` filter requires FFmpeg to be compiled with `--enable-libzimg`. The Alpine `ffmpeg` package includes this. Verify at build time with the RUN command above — if grep returns nothing, the filter is unavailable and you need a different base image or a static FFmpeg build.

Static FFmpeg builds with full codec support: https://johnvansickle.com/ffmpeg/

---

## API routes

### POST /api/upload
Accepts multipart form upload. Returns jobId.

```
Request:  multipart/form-data { file: <video file> }
Response: { jobId: "uuid-v4", duration: 1234.56, filename: "original.mp4" }
```

### POST /api/process
Starts FFmpeg job with correction values.

```
Request:  { jobId: "...", yaw: 12.4, pitch: -3.1, roll: 0.8 }
Response: { jobId: "...", status: "queued" }
```

### GET /api/progress/:jobId
Server-Sent Events stream. Client connects and receives progress updates.

```
data: { status: "processing", progress: 34, eta: 120 }
data: { status: "complete", downloadUrl: "/api/download/uuid" }
data: { status: "failed", error: "Unsupported codec" }
```

### GET /api/download/:jobId
Streams the output file to the client.

```
Response headers:
  Content-Type: video/mp4
  Content-Disposition: attachment; filename="original-aligned.mp4"
  Content-Length: <bytes>
```

### DELETE /api/job/:jobId
Cancels a running job and deletes temp files. Called when user clicks Cancel.

---

## Job queue

For v1, a simple in-memory queue is sufficient — this is a single-user or low-traffic tool, not a public service.

```javascript
const jobs = new Map(); // jobId → { status, process, progress, outputPath }
```

If concurrent usage becomes an issue in future, replace with Bull/BullMQ + Redis. Do not over-engineer for v1.

---

## Environment variables

```env
PORT=3000
MAX_UPLOAD_SIZE_GB=8
OUTPUT_TTL_HOURS=2
ENCODE_CRF=18
ENCODE_PRESET=slow
TEMP_DIR=/tmp/360aligner
```

---

## Coolify configuration

- **Build:** Dockerfile in repo root
- **Port:** 3000
- **Persistent volume:** Not required (temp files are ephemeral by design)
- **Memory limit:** Minimum 2GB recommended. FFmpeg will use significant memory on large files.
- **CPU:** No hard limit — FFmpeg is CPU-bound, more cores = faster processing

---

## File size limits

Configure at the reverse proxy (Coolify/Nginx) level, not just in the app:

```nginx
client_max_body_size 8G;
proxy_read_timeout 3600s;
proxy_send_timeout 3600s;
```

Without the nginx config, large uploads will be rejected at the proxy before reaching the app.

---

## Security

- No authentication required for v1 (internal / GeekyBee use only)
- jobId is UUID v4 — not guessable
- Output files are not listed or indexable — only accessible via known jobId
- Temp files cleaned up on schedule — no indefinite storage
- Do not log uploaded filenames or user data

---

## Monitoring

No formal monitoring for v1. FFmpeg errors are logged to console. Coolify's built-in log viewer is sufficient.
