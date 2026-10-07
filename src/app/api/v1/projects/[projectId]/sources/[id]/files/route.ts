import { createHash } from "crypto";
import { v4 as uuidv4 } from "uuid";
import prisma from "@/lib/prisma";
import { putObject, deleteObject } from "@/lib/storage";
import { checkPermissionForApiKey } from "@/lib/abac-client";
import { checkAccessOrRespond } from "@/lib/abac-route-guard";
import { createExpertAnnotation, resolveExpertCode } from "@/lib/annotations";

// Machine upload for the files extracted from a Source (today: upload.py unpacking a
// zip-file Source). Replaces the legacy POST /api/v1/projects/[projectId]/data, which
// created a `Data` row with a filename and never received the image bytes.
//
// One image per request, multipart field "file". The bytes go to the bucket and a
// DataFile is created under the Source. Its destination is inherited from the Source
// (what the uploader picked in the form), never taken from the caller.
//
// Optional multipart field "expertCode": the class code the expert gave this image
// (label file of an annotated zip). A known code is stored as an EXPERT annotation and
// copied into the object metadata. An unknown code never blocks the image: it is stored
// without category and the response says so.

type Props = {
    params: {
        projectId: string;
        id: string;
    };
};

// Same image extensions the UI upload (src/actions/data.ts) accepts, minus dzi (a
// deep-zoom descriptor, not something a worker extracts from a zip).
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "bmp", "webp", "tiff"];
const MAX_BYTES = 20 * 1024 * 1024;

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

export async function POST(request: Request, { params }: Props) {
    const denied = await checkAccessOrRespond(() =>
        checkPermissionForApiKey(request, params.projectId, "data:write")
    );
    if (denied) return denied;

    // Scoped by projectId: a key from project A cannot write under a Source of project B
    // even if it knows the Source id.
    const source = await prisma.source.findFirst({
        where: { id: params.id, projectId: params.projectId },
        select: { id: true, status: true, destination: true },
    });
    if (!source) {
        return json({ error: "Source not found" }, 404);
    }
    if (source.status === "COMPLETED" || source.status === "FAILED") {
        return json(
            { code: "SOURCE_CLOSED", error: `Source is ${source.status} and no longer accepts files` },
            409
        );
    }

    let form: FormData;
    try {
        form = await request.formData();
    } catch {
        return json({ error: "Expected a multipart/form-data body" }, 400);
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
        return json({ error: "Missing multipart field 'file'" }, 400);
    }
    if (file.size === 0 || file.size > MAX_BYTES) {
        return json({ error: `File must be between 1 byte and ${MAX_BYTES} bytes` }, 400);
    }

    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!IMAGE_EXTENSIONS.includes(extension)) {
        return json({ error: `Unsupported file extension '${extension}'` }, 400);
    }

    const rawExpertCode = form.get("expertCode");
    if (rawExpertCode !== null && typeof rawExpertCode !== "string") {
        return json({ error: "Field 'expertCode' must be text" }, 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Checksum computed here, not trusted from the caller. MD5 matches what upload.py
    // has always used for dedupe; it is an identity check, not a security control.
    const checksum = createHash("md5").update(buffer).digest("hex");

    // MySQL JSON path syntax ("$.checksum"), not the Postgres array form.
    const duplicate = await prisma.dataFile.findFirst({
        where: {
            source: { projectId: params.projectId },
            metadata: { path: "$.checksum", equals: checksum },
        },
        select: { id: true, name: true },
    });
    if (duplicate) {
        return json({ code: "DUPLICATE", error: "Duplicate image", checksum, existing: duplicate }, 409);
    }

    // Looked up after the duplicate check: a duplicate image never receives the label
    // (the existing image may already have an expert category, which is immutable).
    const expert = await resolveExpertCode(prisma, params.projectId, rawExpertCode);

    // Grouped by Source so everything a zip produced sits under one prefix.
    const storageKey = `uploads/zip/${source.id}/${uuidv4()}.${extension}`;
    await putObject(
        storageKey,
        buffer,
        file.type || "application/octet-stream",
        expert.status === "FOUND" ? { "expert-category": expert.code } : undefined
    );

    try {
        // One transaction: an image never exists without the expert category it came with.
        const dataFile = await prisma.$transaction(async (tx) => {
            const created = await tx.dataFile.create({
                data: {
                    sourceId: source.id,
                    name: file.name,
                    filePath: storageKey,
                    type: "IMAGE",
                    destination: source.destination,
                    metadata: { checksum },
                },
            });
            if (expert.status === "FOUND") {
                await createExpertAnnotation(tx, created.id, expert.classTypeId);
            }
            return created;
        });

        if (expert.status === "ABSENT") {
            return json(dataFile, 201);
        }
        const expertCategory =
            expert.status === "FOUND"
                ? { stored: true, code: expert.code }
                : { stored: false, reason: "UNKNOWN_CODE", code: expert.code };
        return json({ ...dataFile, expertCategory }, 201);
    } catch (error) {
        // Do not leave an orphan object in the bucket if the rows could not be created.
        await deleteObject(storageKey).catch((e) =>
            console.error(`Failed to clean up ${storageKey} after DataFile create error:`, e)
        );
        throw error;
    }
}