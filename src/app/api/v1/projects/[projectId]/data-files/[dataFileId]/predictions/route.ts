import prisma from "@/lib/prisma";
import { checkPermissionForApiKey } from "@/lib/abac-client";
import { checkAccessOrRespond } from "@/lib/abac-route-guard";
import { createMlAnnotation } from "@/lib/annotations";
import { predictionBodySchema, resolveLabelCodes } from "@/lib/predictions";

type Props = {
    params: {
        projectId: string;
        dataFileId: string;
    };
};

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

/**
 * POST /api/v1/projects/[projectId]/data-files/[dataFileId]/predictions
 * Saves what a model version predicted for one image: up to 3 class codes with their
 * confidence, stored as one image-level ML annotation.
 *
 * 201 when the prediction is created; 200 with the existing one, and nothing written,
 * when this model version already predicted this image. A prediction is never updated
 * or deleted: a new model version adds another one.
 *
 * Authenticated with the project API key (data:write).
 */
export async function POST(request: Request, { params }: Props) {
    const denied = await checkAccessOrRespond(() =>
        checkPermissionForApiKey(request, params.projectId, "data:write")
    );
    if (denied) return denied;

    let raw: unknown;
    try {
        raw = await request.json();
    } catch {
        return json({ error: "Expected a JSON body" }, 400);
    }

    const parsed = predictionBodySchema.safeParse(raw);
    if (!parsed.success) {
        return json(
            {
                error: "Invalid prediction",
                issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
            },
            400
        );
    }
    const { modelVersion, labels } = parsed.data;

    // Scoped by projectId: a key from project A cannot write on an image of project B
    // even if it knows the DataFile id.
    const dataFile = await prisma.dataFile.findFirst({
        where: { id: params.dataFileId, source: { projectId: params.projectId } },
        select: { id: true },
    });
    if (!dataFile) {
        return json({ error: "Data file not found" }, 404);
    }

    const classTypes = await prisma.classType.findMany({
        where: {
            projectId: params.projectId,
            status: "ACTIVE",
            code: { in: labels.map((l) => l.code) },
        },
        select: { id: true, code: true },
    });
    const resolved = resolveLabelCodes(labels, classTypes);
    if (!resolved.ok) {
        return json(
            {
                code: "UNKNOWN_CODE",
                error: "Some codes are not active classes of this project",
                unknownCodes: resolved.unknownCodes,
            },
            400
        );
    }

    const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.annotation.findFirst({
            where: { dataFileId: dataFile.id, author: "ML", modelVersion },
            select: { id: true },
        });
        const annotationId =
            existing?.id ??
            (await createMlAnnotation(tx, dataFile.id, modelVersion, resolved.labels)).id;

        const annotation = await tx.annotation.findUniqueOrThrow({
            where: { id: annotationId },
            select: {
                id: true,
                dataFileId: true,
                modelVersion: true,
                confidence: true,
                createdAt: true,
                annotationTypes: {
                    orderBy: { rank: "asc" },
                    select: {
                        rank: true,
                        confidence: true,
                        classType: { select: { code: true } },
                    },
                },
            },
        });
        return { annotation, created: !existing };
    });

    const { annotationTypes, ...annotation } = result.annotation;
    return json(
        {
            ...annotation,
            labels: annotationTypes.map((t) => ({
                code: t.classType.code,
                confidence: t.confidence,
                rank: t.rank,
            })),
        },
        result.created ? 201 : 200
    );
}