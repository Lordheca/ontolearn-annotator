import { SourceStatus } from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/prisma";                      
import { checkPermissionForApiKey } from "@/lib/abac-client";
import { checkAccessOrRespond } from "@/lib/abac-route-guard";

type Props = {
    params: {
        projectId: string;
        id: string;
    };
};

// Summary of an annotated zip, written by upload.py: how many rows of the label file
// ended up as expert categories, and why the others did not.
const labelsSummarySchema = z.object({
    file: z.string(),
    rows: z.number().int().nonnegative(),
    stored: z.number().int().nonnegative(),
    unknownCode: z.number().int().nonnegative(),
    notInZip: z.number().int().nonnegative(),
    withoutLabel: z.number().int().nonnegative(),
    notApplied: z.number().int().nonnegative(),
})

const statusInfoSchema = z.object({
    "message": z.string().optional(),
    "problems": z.array(z.string()).optional(),
    "labels": labelsSummarySchema.optional()
})

export async function PATCH(request: Request, { params } : Props) {

    const denied = await checkAccessOrRespond(() => 
        checkPermissionForApiKey(request, params.projectId, "source:write")
    ); 
    if (denied) return denied;
    
    const schema = z.object({
        name: z.string().optional(),
        status: z.nativeEnum(SourceStatus).optional(),
        statusInfo: statusInfoSchema.optional()
    })

    const { projectId } = params;
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

    const updatedSource = await prisma.source.update({
        where: {
            id: params.id,
            projectId,
        },
        data: {
            ...data.data
        }
    });

    return new Response(JSON.stringify(updatedSource), {
        headers: {
            "content-type": "application/json",
        },
    });
}