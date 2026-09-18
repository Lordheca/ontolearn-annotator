/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";

// storage.ts only needs the S3_* vars, but src/env.ts validates the app's
// entire schema (DATABASE_URL, GITHUB_CLIENT_ID, ABAC_SERVER_URL, etc.).
// Mocking @/env here scopes this test to what storage.ts actually uses,
// instead of requiring dummy values for every unrelated service just to
// satisfy Zod. Values match the standalone local MinIO container used for
// this Step 6 verification (see the plan document's setup notes).
vi.mock("@/env", () => ({
  env: {
    S3_ENDPOINT: process.env.S3_ENDPOINT ?? "http://localhost:9000",
    S3_BUCKET: process.env.S3_BUCKET ?? "ontolearn-storage-test",
    S3_ACCESS_KEY: process.env.S3_ACCESS_KEY ?? "minioadmin",
    S3_SECRET_KEY: process.env.S3_SECRET_KEY ?? "minioadmin",
    S3_REGION: process.env.S3_REGION ?? "us-east-1",
    S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE !== "false",
  },
}));

import { putObject, getObjectStream, deleteObject } from "@/lib/storage";

describe("storage (S3/MinIO)", () => {
  it("round-trips a buffer through putObject/getObjectStream", async () => {
    const key = `test/${Date.now()}-roundtrip.txt`;
    const original = Buffer.from("File Storage Remediation Plan - Step 6");

    await putObject(key, original, "text/plain");

    const stream = await getObjectStream(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    const roundtripped = Buffer.concat(chunks);

    expect(roundtripped.equals(original)).toBe(true);

    await deleteObject(key);
  });

  it("deleteObject actually removes the object", async () => {
    const key = `test/${Date.now()}-delete.txt`;
    await putObject(key, Buffer.from("delete me"), "text/plain");
    await deleteObject(key);

    await expect(getObjectStream(key)).rejects.toThrow();
  });
});