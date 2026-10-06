import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { PermissionDeniedError, requireRead } from "@/lib/abac-guards";
import { sortByPosition } from "@/lib/class-types-order";

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    // Check authentication
    const session = await auth();
    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { slug } = params;

    // Get exclude query parameter
    const searchParams = request.nextUrl.searchParams;
    const excludeParam = searchParams.get("exclude");
    const excludeList = excludeParam 
      ? excludeParam.split(",").map(item => item.trim())
      : [];

    // Get project by slug
    const project = await db.project.findUnique({
      where: { slug },
    });

    if (!project) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      );
    }

    // A session alone used to be enough. task:read rather than settings:read because
    // DataSourceLoader fetches this from the browser during a workflow run, and it is a
    // cacheable action so annotating stays fast.
    try {
      await requireRead(project.id, "task");
    } catch (error) {
      if (error instanceof PermissionDeniedError) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      throw error;
    }

    // Fetch active class types for the project
    const classTypes = await db.classType.findMany({
      where: {
        projectId: project.id,
        status: "ACTIVE",
      },
      orderBy: {
        name: "asc",
      },
    });

    // Legend order for imported classes, then the hand-typed ones by name.
    // Filter out excluded types and return as array of strings
    const filteredClassTypes = sortByPosition(classTypes)
      .map(ct => ct.name)
      .filter(name => !excludeList.includes(name));

    return NextResponse.json(filteredClassTypes);
  } catch (error) {
    console.error("Error fetching class types:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
