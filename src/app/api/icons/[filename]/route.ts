import path from "path";
import { Readable } from "stream";
import { getObjectStream } from "@/lib/storage";

// File Storage Remediation Plan, Phase 2 Step 8: icons move off local disk
// along with the other two write sites (src/actions/projects.ts), into the
// same MinIO/S3 bucket storage.ts already talks to. This route replaces the
// plain public/img/projects/<icon> static URL those writes used to land on.
//
// Deliberately unauthenticated -- §5.2 confirmed project icons stay public
// (low-sensitivity, used in plain <Image> tags in project-picker lists), so
// this route does not call checkAccessOrRespond the way /api/files/[id]
// does for DataFile/PlaygroundTask/SourceField reads.

const CONTENT_TYPES: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
};

type Props = {
    params: {
        filename: string;
    };
};

export async function GET(_request: Request, { params }: Props) {
    const { filename } = params;

    // project.icon values are always `${projectId}.png` -- no path separators.
    // Reject anything else instead of forwarding it into the bucket key.
    if (filename.includes("/") || filename.includes("..")) {
        return new Response(JSON.stringify({ error: "Invalid filename" }), {
            status: 400,
            headers: { "content-type": "application/json" },
        });
    }

    const ext = path.extname(filename).toLowerCase();
    const contentType = CONTENT_TYPES[ext] || "application/octet-stream";

    try {
        const stream = await getObjectStream(`icons/${filename}`);
        return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
            status: 200,
            headers: {
                "content-type": contentType,
                "cache-control": "public, max-age=0, must-revalidate",
            },
        });
    } catch {
        return new Response(JSON.stringify({ error: "Icon not found" }), {
            status: 404,
            headers: { "content-type": "application/json" },
        });
    }
}