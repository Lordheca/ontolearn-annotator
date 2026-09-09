import prisma from "@/lib/prisma";
import { z } from "zod";
import { checkPermissionForApiKey } from "@/lib/abac-client";
import { checkAccessOrRespond } from "@/lib/abac-route-guard";

export async function PATCH(
    request: Request,
    { params } : { params: { id: string } }
) {
    const schema = z.object({
        name: z.string().optional(),
        type: z.enum(["IMAGE", "DEEP_ZOOM_IMAGE"]).optional(),
        status: z.enum(["PENDING", "PROCESSING", "COMPLETED"]),
        statusInfo: z.record(z.string(), z.string().or(z.number())).optional()
    });

    const body = await request.json();
    const data = schema.safeParse(body);

    if (!data.success) {
        return new Response(JSON.stringify({ error: "Invalid body", errors: data.error }), {
            status: 400,
            headers: {
                "content-type": "application/json",
            },
        });
    }

    const existingData = await prisma.data.findUnique({
        where: {
            id: params.id,
        },
    });

    if (!existingData) {
        return new Response(JSON.stringify({ error: "Data not found" }), {
            status: 404,
            headers: {
                "content-type": "application/json",
            },
        });
    }
    
    const denied = await checkAccessOrRespond(() => 
        checkPermissionForApiKey(request,existingData.projectId, "data:write")
    ); 

    if (denied) return denied;
    
    const updatedData = await prisma.data.update({
        where: {
            id: params.id,
        },
        data: data.data
    });

    return new Response(JSON.stringify(updatedData), {
        headers: {
            "content-type": "application/json",
        },
    });
}