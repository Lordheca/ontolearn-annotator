import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { PermissionDeniedError, requireRead, requireWrite } from "@/lib/abac-guards";
import { z } from "zod";
import { sortByPosition } from "@/lib/class-types-order";

// Validation schema
const classTypeSchema = z.object({
  name: z.string().min(1).max(100),
});

const CLASS_TYPE_STATUSES = ["ACTIVE", "INACTIVE", "DEPRECATED"] as const;
type ClassTypeStatus = (typeof CLASS_TYPE_STATUSES)[number];

function isClassTypeStatus(value: string): value is ClassTypeStatus {
  return (CLASS_TYPE_STATUSES as readonly string[]).includes(value);
}

/**
 * GET /api/projects/[slug]/class-types
 * List all class types for a project (including inactive)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = params;
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get("status"); // optional filter

    // Get project
    const project = await db.project.findUnique({
      where: { slug },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // A session alone used to be enough here, so any logged-in user could read a
    // private project's whole class vocabulary, usage counts included.
    try {
      await requireRead(project.id, "settings");
    } catch (error) {
      if (error instanceof PermissionDeniedError) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      throw error;
    }

    // Validated rather than cast: `status as any` let ?status=bogus reach Prisma and
    // come back as a 500.
    let statusFilter: ClassTypeStatus | undefined;
    if (status) {
      if (!isClassTypeStatus(status)) {
        return NextResponse.json(
          { error: `Invalid status: expected one of ${CLASS_TYPE_STATUSES.join(", ")}` },
          { status: 400 }
        );
      }
      statusFilter = status;
    }

    // Fetch class types with usage count
    const classTypes = await db.classType.findMany({
      where: {
        projectId: project.id,
        ...(statusFilter && { status: statusFilter }),
      },
      include: {
        _count: {
          select: { annotationTypes: true },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json(sortByPosition(classTypes));
  } catch (error) {
    console.error("[GET /api/projects/[slug]/class-types] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/projects/[slug]/class-types
 * Create a new class type
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = params;
    const body = await request.json();

    // Validate input
    const validation = classTypeSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }

    const { name } = validation.data;

    // Get project
    const project = await db.project.findUnique({
      where: { slug },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // A session is not enough: defining the project's vocabulary is an ADMIN act.
    // The policy grants settings:write to ADMIN only, so a USER is refused here.
    try {
      await requireWrite(project.id, "settings");
    } catch (error) {
      if (error instanceof PermissionDeniedError) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      throw error;
    }

    // Check if class type name already exists for this project
    const existing = await db.classType.findFirst({
      where: {
        projectId: project.id,
        name,
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: "Class type with this name already exists" },
        { status: 409 }
      );
    }

    // Create class type
    const classType = await db.classType.create({
      data: {
        projectId: project.id,
        name,
        status: "ACTIVE",
      },
    });

    return NextResponse.json(classType, { status: 201 });
  } catch (error) {
    console.error("[POST /api/projects/[slug]/class-types] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
