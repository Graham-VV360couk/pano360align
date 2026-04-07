import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createReadStream, createWriteStream } from "fs";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

export const S3_BUCKET = process.env.AWS_S3_BUCKET || "";
export const S3_REGION = process.env.AWS_REGION || "eu-north-1";
export const PRESIGN_PUT_EXPIRY = parseInt(process.env.PRESIGN_PUT_EXPIRY_SECONDS || "3600");
export const PRESIGN_GET_EXPIRY = parseInt(process.env.PRESIGN_GET_EXPIRY_SECONDS || "3600");

let _client: S3Client | null = null;
export function s3(): S3Client {
  if (_client) return _client;
  _client = new S3Client({
    region: S3_REGION,
    credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined,
    // Disable the default checksum behaviour added in aws-sdk v3.7xx.
    // Without this, presigned PUT URLs include x-amz-checksum-crc32 of an
    // EMPTY body, which the browser can't satisfy when it sends a real
    // multi-GB file → S3 silently rejects with a signature mismatch and
    // the upload stalls invisibly. WHEN_REQUIRED restores the old "only
    // add a checksum when the API explicitly requires it" behaviour.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return _client;
}

/** Build the canonical S3 key for a given job + filename. */
export function jobKey(jobId: string, name: "input" | "output" | "job", ext = ""): string {
  if (name === "job") return `jobs/${jobId}/job.json`;
  if (name === "output") return `jobs/${jobId}/output.mp4`;
  return `jobs/${jobId}/input.${ext || "mp4"}`;
}

export async function presignPut(key: string, contentType?: string): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3(), cmd, { expiresIn: PRESIGN_PUT_EXPIRY });
}

export async function presignGet(key: string, downloadFilename?: string): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    ResponseContentDisposition: downloadFilename ? `attachment; filename="${downloadFilename}"` : undefined,
  });
  return getSignedUrl(s3(), cmd, { expiresIn: PRESIGN_GET_EXPIRY });
}

export async function putJson(key: string, body: unknown): Promise<void> {
  await s3().send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: JSON.stringify(body),
    ContentType: "application/json",
  }));
}

export async function getJson<T>(key: string): Promise<T | null> {
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    const text = await res.Body!.transformToString();
    return JSON.parse(text) as T;
  } catch (err: unknown) {
    const e = err as { name?: string };
    if (e?.name === "NoSuchKey" || e?.name === "NotFound") return null;
    throw err;
  }
}

export async function headExists(key: string): Promise<boolean> {
  try {
    await s3().send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    return true;
  } catch (err: unknown) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
}

export async function deleteObject(key: string): Promise<void> {
  await s3().send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
}

/** Delete every object under a given prefix. */
export async function deletePrefix(prefix: string): Promise<void> {
  let token: string | undefined;
  do {
    const list = await s3().send(new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: prefix,
      ContinuationToken: token,
    }));
    if (list.Contents) {
      for (const obj of list.Contents) {
        if (obj.Key) await deleteObject(obj.Key);
      }
    }
    token = list.NextContinuationToken;
  } while (token);
}

/** Download an S3 object to a local path, streaming. */
export async function downloadToFile(key: string, localPath: string): Promise<void> {
  const res = await s3().send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  const body = res.Body as Readable;
  await pipeline(body, createWriteStream(localPath));
}

/** Upload a local file to S3, streaming. */
export async function uploadFromFile(localPath: string, key: string, contentType?: string): Promise<void> {
  const stream = createReadStream(localPath);
  await s3().send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: stream,
    ContentType: contentType,
  }));
}

/** List all jobIds under jobs/ prefix (one level deep). */
export async function listJobIds(): Promise<string[]> {
  const ids = new Set<string>();
  let token: string | undefined;
  do {
    const list = await s3().send(new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: "jobs/",
      Delimiter: "/",
      ContinuationToken: token,
    }));
    for (const cp of list.CommonPrefixes || []) {
      if (cp.Prefix) {
        const m = cp.Prefix.match(/^jobs\/([^/]+)\/$/);
        if (m) ids.add(m[1]);
      }
    }
    token = list.NextContinuationToken;
  } while (token);
  return Array.from(ids);
}
