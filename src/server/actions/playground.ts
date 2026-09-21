"use server";

import { uploadPlaygroundInputSchema } from "@/lib/validation-schemas/playground";
import { canWritePlayground } from "@/lib/zsa-procedures";
import { Prisma } from "@prisma/client";
import { putObject } from "@/lib/storage";
import { v4 as uuidv4 } from "uuid";

export const uploadPlayground = canWritePlayground
  .createServerAction()
  .input(uploadPlaygroundInputSchema, {
    type: "formData",
  })
  .handler(async ({ input, ctx }) => {
    const { user, prisma } = ctx;
    const { file } = input;

    const fileExtension = file.name.split(".").pop();
    const fileName = `${uuidv4()}.${fileExtension}`;

    // File Storage Remediation Plan, Phase 1 Step 1: this used to write into
    // public/uploads/playground, served statically with no permission check. It now
    // writes into storage/uploads/playground instead -- outside public/, not served by
    // Next.js -- so the file is reachable only once Step 2's /api/files/[id] route
    // (ABAC-gated) exists. The stored key has no leading slash from here on: it is a
    // storage key, not a URL a browser can hit directly.
    //
    // File Storage Remediation Plan, Phase 2 Step 8: "storage/uploads/playground" is now
    // the object key prefix inside the MinIO bucket (storage.ts) -- no local directory is
    // created or written to here anymore.
    const storageKey = `uploads/playground/${fileName}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await putObject(storageKey, buffer, file.type || "application/octet-stream");

    const inputJSON = {
      file: storageKey,
    } as Prisma.JsonObject;

    const playgroundTask = await prisma.playgroundTask.create({
      data: {
        projectId: ctx.project.id,
        status: "PENDING",
        input: inputJSON,
        createdById: user.id,
      },
    });

    return playgroundTask;
  });
