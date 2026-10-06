import prisma from "@/lib/prisma";
import { NextRequest } from "next/server";
import { checkPermissionForApiKey } from "@/lib/abac-client";
import { checkAccessOrRespond } from "@/lib/abac-route-guard";

type Props = {
    params: {
        projectId: string;
    };
};

/**
 * GET /api/v1/projects/[projectId]/class-types
 * The project's class list as the ML side knows it: the ACTIVE classes that have a
 * code, in the order of the imported classes.csv (the model's output order).
 *
 * Authenticated with the project API key. task:read is used because the MACHINE role
 * already has it, so no policy change is needed.
 */
export async function GET(request: NextRequest, { params }: Props) {
    const denied = await checkAccessOrRespond(() =>
        checkPermissionForApiKey(request, params.projectId, "task:read")
    );
    if (denied) return denied;

    const project = await prisma.project.findUnique({
        where: {
            id: params.projectId
        }
    });

    if (!project) {
        return new Response(JSON.stringify({ error: "Project not found" }), {
            status: 404,
            headers: {
                "content-type": "application/json",
            },
        });
    }

    // Classes typed by hand have no code and no position: they are not part of the
    // list shared with the model, so they are left out.
    const classTypes = await prisma.classType.findMany({
        where: {
            projectId: params.projectId,
            status: "ACTIVE",
            code: { not: null },
        },
        orderBy: {
            position: "asc",
        },
        select: {
            code: true,
            name: true,
            parent: { select: { code: true } },
        },
    });

    const classes = classTypes.map((classType) => ({
        code: classType.code,
        name: classType.name,
        parentCode: classType.parent?.code ?? null,
    }));

    return new Response(JSON.stringify(classes), {
        headers: {
            "content-type": "application/json",
        },
    });
}