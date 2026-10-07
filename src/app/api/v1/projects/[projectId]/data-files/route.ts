import prisma from "@/lib/prisma";
import { checkPermissionForApiKey } from "@/lib/abac-client";
import { checkAccessOrRespond } from "@/lib/abac-route-guard";
import { parseWithoutPredictionQuery, whereWithoutPrediction } from "@/lib/predictions";

type Props = {
    params: {
        projectId: string;
    };
};

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

/**
 * GET /api/v1/projects/[projectId]/data-files?withoutPrediction=<modelVersion>&limit=50
 * The images the inference worker still has to classify with that model version,
 * oldest first. It looks at DataFiles, whatever created them (zip, single image or
 * small batch), not at Sources.
 *
 * Authenticated with the project API key (data:read).
 */
export async function GET(request: Request, { params }: Props) {
    const denied = await checkAccessOrRespond(() =>
        checkPermissionForApiKey(request, params.projectId, "data:read")
    );
    if (denied) return denied;

    const query = parseWithoutPredictionQuery(new URL(request.url).searchParams);
    if (!query.ok) {
        return json({ error: query.error }, 400);
    }

    const dataFiles = await prisma.dataFile.findMany({
        where: whereWithoutPrediction(params.projectId, query.modelVersion),
        // id breaks ties: images of one zip can share the same createdAt.
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: query.limit,
        select: { id: true, name: true },
    });

    return json(dataFiles);
}