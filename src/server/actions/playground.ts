"use server";

import { uploadPlaygroundInputSchema } from "@/lib/validation-schemas/playground";
import { canWritePlayground } from "@/lib/zsa-procedures";
import { Prisma } from "@prisma/client";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { v4 as uuidv4 } from "uuid";
import path from "path";

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
    const storageKey = `uploads/playground/${fileName}`;
    const uploadDir = path.join(process.cwd(), "storage", "uploads", "playground");
    if (!existsSync(uploadDir)){
      mkdirSync(uploadDir, { recursive: true});
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);
    writeFileSync(path.join(uploadDir,fileName), buffer);

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
