import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { PermissionDeniedError, requireWrite } from "@/lib/abac-guards";
import {
  ClassImportConflictError,
  ClassImportError,
  parseClassesCsv,
  planImport,
  summarizePlan,
} from "@/lib/class-types-import";
import { z } from "zod";

const importSchema = z.object({
  // The text of a classes.csv file. 26 classes are about 1 KB; 500 fit well under this.
  csv: z.string().min(1).max(200_000),
  dryRun: z.boolean(),
});

/**
 * POST /api/projects/[slug]/class-types/import
 * Imports a class list (classes.csv) into the project's class types.
 *
 * Body: { csv: string, dryRun: boolean }. With dryRun = true nothing is written and
 * the response says what the import would do; the real import returns the same shape.
 * The import only creates classes or adds information to existing ones: it never
 * deletes or deactivates a class.
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

    const validation = importSchema.safeParse(await request.json().catch(() => null));
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }
    const { csv, dryRun } = validation.data;

    const project = await db.project.findUnique({
      where: { slug: params.slug },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Same guard as the other class-type writes: settings:write, ADMIN only.
    try {
      await requireWrite(project.id, "settings");
    } catch (error) {
      if (error instanceof PermissionDeniedError) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      throw error;
    }

    const rows = parseClassesCsv(csv);

    // The plan is computed inside the transaction that applies it, so it is always
    // based on the classes as they are at write time.
    const summary = await db.$transaction(
      async (tx) => {
        const existing = await tx.classType.findMany({
          where: { projectId: project.id },
          select: { id: true, name: true, code: true, position: true, relatedId: true },
        });
        const plan = planImport(rows, existing);
        if (dryRun) return summarizePlan(plan);

        // First every row, then the parents: a child can come before the
        // transaction knows the id of its parent.
        const idByCode = new Map<string, string>();
        for (const action of plan.actions) {
          const { code, name, position } = action.row;
          if (action.kind === "create") {
            const created = await tx.classType.create({
              data: { projectId: project.id, name, code, position, status: "ACTIVE" },
            });
            idByCode.set(code, created.id);
          } else {
            idByCode.set(code, action.id);
            if (action.kind !== "unchanged") {
              await tx.classType.update({
                where: { id: action.id },
                data: { name, code, position },
              });
            }
          }
        }

        for (const action of plan.actions) {
          if (action.kind === "unchanged") continue;
          const { code, parentCode } = action.row;
          await tx.classType.update({
            where: { id: idByCode.get(code) },
            data: { relatedId: parentCode === null ? null : idByCode.get(parentCode) ?? null },
          });
        }

        return summarizePlan(plan);
      },
      { timeout: 30_000 }
    );

    return NextResponse.json(summary);
  } catch (error) {
    // The message of a ClassImportError is written for the user.
    if (error instanceof ClassImportConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof ClassImportError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[POST /api/projects/[slug]/class-types/import] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}