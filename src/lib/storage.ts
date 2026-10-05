import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import type { Readable } from "stream";
import { env } from "@/env";

// File Storage Remediation Plan, Phase 2 Step 6: storage abstraction over
// an S3-compatible backend (MinIO locally / in the current deployment,
// swappable to managed AWS S3 later via env vars alone -- §5.3). This is
// what actually fixes the blocking-I/O half of TODO.md's "Real file
// storage" item -- all three operations are async, unlike the writeFileSync
// calls in src/actions/data.ts, src/actions/projects.ts and
// src/server/actions/playground.ts that Step 8 replaces with putObject.
// `metadata` is stored as S3 user metadata (x-amz-meta-<name>). Values must be ASCII.
const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
  },
});

const BUCKET = env.S3_BUCKET;

export async function putObject(
  key: string,
  buffer: Buffer,
  contentType: string,
  metadata?: Record<string, string>
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      Metadata: metadata,
    })
  );
}

export async function getObjectStream(key: string): Promise<Readable> {
  const result = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key })
  );

  if (!result.Body) {
    throw new Error(`Object not found or empty body: ${key}`);
  }

  // The SDK types Body as a union (web ReadableStream | Blob | Readable)
  // because it also compiles for browser/edge runtimes. In this app's
  // Node runtime (same as route.ts, which uses fs) result.Body is always
  // a Node Readable.
  return result.Body as Readable;
}

export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (error: any) {
    if (error?.name === "NotFound" || error?.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw error; // a real connectivity/permissions error should surface, not be swallowed as "safe to overwrite"
  }
}