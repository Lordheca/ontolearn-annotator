import prisma from "@/lib/prisma";
import { PlaygroundTaskStatus } from "@prisma/client";
import { NextRequest } from "next/server";
import { checkPermissionForApiKey } from "@/lib/abac-client";
import { checkAccessOrRespond } from "@/lib/abac-route-guard";

type Props = {
    params: {
        projectId: string;
    },
};

export async function GET(request: NextRequest, { params } : Props) {

    const denied = await checkAccessOrRespond(() =>
        checkPermissionForApiKey(request, params.projectId, "playground:read")
    ); 
    if (denied) return denied;

    // Check if the project exists
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

    const status = request.nextUrl.searchParams.get('status');
    let where: {
        projectId: string;
        status?: PlaygroundTaskStatus;
    } = {
        projectId: params.projectId
    };

    if (status && status in PlaygroundTaskStatus) {
        where = {
            ...where,
            status: status as PlaygroundTaskStatus
        };
    }

    const tasks = await prisma.playgroundTask.findMany({
        where: where
    });

    return new Response(JSON.stringify(tasks), {
        headers: {
            "content-type": "application/json",
        },
    });   
}
