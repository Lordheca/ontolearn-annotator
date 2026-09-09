import { TaskStatus } from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { checkPermissionForApiKey } from "@/lib/abac-client";
import { checkAccessOrRespond } from "@/lib/abac-route-guard";

type Props = {
  params: {
    projectId: string;
  };
};

export async function POST(request: Request, { params }: Props) {

  const denied = await checkAccessOrRespond(() =>
    checkPermissionForApiKey(request, params.projectId, "task:write")
  ); 
  if (denied) return denied;
  
  const schema = z.object({
    input: z.any(),
    type: z.string(),
  });

  const body = await request.json();
  const data = schema.safeParse(body);

  if (!data.success) {
    return new Response(
      JSON.stringify({ error: "Invalid body", errors: data.error }),
      {
        status: 400,
        headers: {
          "content-type": "application/json",
        },
      }
    );
  }

  // Check if the project exists
  const project = await prisma.project.findUnique({
    where: {
      id: params.projectId,
    },
  });

  if (!project) {
    return new Response(JSON.stringify({ error: "Project not found" }), {
      status: 404,
      headers: {
        "content-type": "application/json",
      },
    });
  }

  const createdData = await prisma.task.create({
    data: {
      ...data.data,
      input: data.data.input,
      projectId: params.projectId,
      status: TaskStatus.PENDING,
    },
  });

  return new Response(JSON.stringify(createdData), {
    headers: {
      "content-type": "application/json",
    },
  });
}
