import path from "path";
import { existsSync, readFileSync, statSync } from "fs";
import prisma from "@/lib/prisma";
import { checkPermission, checkPermissionForApiKey } from "@/lib/abac-client";
import { checkAccessOrRespond } from "@/lib/abac-route-guard";
import { Readable } from "stream";
import { getObjectStream } from "@/lib/storage";

// File Storage Remediation Plan, Phase 1 Step 2: the authenticated read path
// that replaces the raw public/uploads and public/img/projects URLs closed
// off in Step 1. `id` is the id of the record that owns the file -- a
// DataFile, or a PlaygroundTask for its input image. Project icons are not
// served here: they were confirmed to stay public (§5.2), so they are never
// gated and never need this route.
//
// Supports both callers this route has to serve: a signed-in browser
// session (Step 3's UI consumers -- no Authorization header, so we fall
// back to the session cookie via checkPermission) and a machine caller
// authenticating with a project-scoped API key (Step 4's playground.py /
// upload.py, which send "Authorization: Bearer <key>" on every request, so
// we route those through checkPermissionForApiKey instead). Same ABAC
// action either way -- only how the caller is resolved differs.
//
// §5.4 dual-read window: filePath / input.file values written before this
// plan still carry their old leading-slash public/ path (e.g.
// "/uploads/foo.jpg"); values written from Step 1 onward carry a
// leading-slash-free storage key (e.g. "uploads/foo.jpg") instead. Both are
// served correctly here without a hard cutover -- see resolveDiskPath.

type Props = {
    params: {
        id: string;
    };
};

const CONTENT_TYPES: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
    ".zip": "application/zip",
    ".pdf": "application/pdf",
};

// A leading "/" marks a pre-Step-1 value: the old public/-relative path
// (public/uploads/... or public/img/projects/...). No leading slash marks a
// Step-1-or-later storage key, rooted at storage/ instead. See §5.4.
function resolveDiskPath(storedPath: string): string {
    if (storedPath.startsWith("/")) {
        return path.join(process.cwd(), "public", storedPath);
    }
    return path.join(process.cwd(), "storage", storedPath);
}

function notFound(): Response {
    return new Response(JSON.stringify({ error: "File not found" }), {
        status: 404,
        headers: {
            "content-type": "application/json",
        },
    });
}

async function streamFile(storedPath: string, downloadName: string): Promise<Response> {
    const diskPath = resolveDiskPath(storedPath);
    const ext = path.extname(diskPath).toLowerCase();
    const contentType = CONTENT_TYPES[ext] || "application/octet-stream";
    const headers = {
        "content-type": contentType,
        "content-disposition": `inline; filename="${downloadName.replace(/"/g, "")}"`,
        "cache-control": "private, max-age=0, must-revalidate",
    };

    // §5.4 dual-read: rows written before Phase 2 (Step 8) still have their
    // bytes on local disk -- either the old public/ path (leading slash) or
    // the Phase-1 storage/ path (no leading slash, still on disk at that
    // point). Disk is checked first so those rows keep working unchanged.
    // A Phase-2 upload (Step 8 onward) never touches disk -- it exists only
    // in the bucket -- so a miss here falls through to the object-storage
    // branch below. Once §Step 9's backfill empties storage/ and
    // public/uploads for good, every read will fall through to the bucket,
    // and this disk branch can be deleted (§7).
    if (existsSync(diskPath)) {
            const stat = statSync(diskPath);
            const buffer = readFileSync(diskPath);
            return new Response(buffer, {
                status: 200,
                headers: { ...headers, "content-length": String(stat.size) },
            });
    }

    // A leading-slash (pre-Step-1) value with nothing on disk is genuinely
    // missing -- it was never a bucket key, so there's nothing to fetch.
    if (storedPath.startsWith("/")) {
        return notFound();
    }

    try {
        const stream = await getObjectStream(storedPath);
        return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
            status: 200,
            headers,
        });
    } catch {
        return notFound();
    }
}

// Session cookie when there's no Authorization header (browser UI, Step 3);
// API key when there is one (ML worker scripts, Step 4). Same ABAC action.
function checkReadAccess(
    request: Request,
    projectId: string,
    action: "data:read" | "playground:read" | "source:read"
): Promise<boolean> {
    const hasApiKey = request.headers.get("authorization") !== null;
    return hasApiKey
        ? checkPermissionForApiKey(request, projectId, action)
        : checkPermission(projectId, action);
}

export async function GET(request: Request, { params }: Props) {
    const dataFile = await prisma.dataFile.findUnique({
        where: { id: params.id },
        include: { source: true },
    });

    if (dataFile) {
        const denied = await checkAccessOrRespond(() =>
            checkReadAccess(request, dataFile.source.projectId, "data:read")
        );
        if (denied) return denied;

        return streamFile(dataFile.filePath, dataFile.name);
    }

    const playgroundTask = await prisma.playgroundTask.findUnique({
        where: { id: params.id },
    });

    if (playgroundTask) {
        const input = playgroundTask.input as { file?: string } | null;
        if (!input?.file) {
            return notFound();
        }

        const denied = await checkAccessOrRespond(() =>
            checkReadAccess(request, playgroundTask.projectId, "playground:read")
        );
        if (denied) return denied;

        return streamFile(input.file, `${playgroundTask.id}${path.extname(input.file)}`);
    }
    // File Storage Remediation Plan, Step 4: upload.py downloads a Source's
    // zip through this same proxy, authenticated with its project-scoped API
    // key -- id here is the SourceField's own id (source.fields[0].id), not
    // the Source's id, since a Source can in principle carry more than one
    // field and only a FILE-type field has bytes to stream.
    
    const sourceField = await prisma.sourceField.findUnique({
        where: { id: params.id },
        include: { source: true, field: true },
    });

    if (sourceField && sourceField.field.type === "FILE") {
        const denied = await checkAccessOrRespond(() =>
            checkReadAccess(request, sourceField.source.projectId, "source:read")
        );
        if (denied) return denied;

        return streamFile(sourceField.value, `${sourceField.id}${path.extname(sourceField.value)}`);
    }

    return notFound();
}
