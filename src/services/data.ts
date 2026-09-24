import prisma from "@/lib/prisma";
import { requireRead } from "@/lib/abac-guards";

/**
 * A recently uploaded file, as the dashboard table needs it.
 *
 * `DataFile` hangs off a `Source` rather than off the project, so the project-scoped
 * shape is built here instead of leaking the join into the table columns.
 */
export type RecentDataFile = {
    id: string;
    name: string;
    uploadedAt: Date;
    filePath: string;
};

export default async function fetchLastData(projectId: string): Promise<RecentDataFile[]> {
    // Check permission to read data
    await requireRead(projectId, "data");

    // Reads DataFile, not the older Data model: uploads made through the UI land in
    // DataFile, so the dashboard used to show "No data available" for a project that
    // had files. See TODO.md — Data is still what /api/v1/.../data writes.
    const files = await prisma.dataFile.findMany({
        where: {
            source: {
                projectId: projectId,
            },
        },
        orderBy: {
            createdAt: "desc",
        },
        take: 5,
        select: {
            id: true,
            name: true,
            createdAt: true,
            filePath: true,
        },
    });

    return files.map((file) => ({
        id: file.id,
        name: file.name,
        uploadedAt: file.createdAt,
        filePath: file.filePath,
    }));
}

/**
 * Every DataFile in a project, newest first -- what the Data page's own
 * "Data" tab needs. Kept separate from fetchLastData (the Dashboard's
 * 5-most-recent widget) so that call site's behavior doesn't change.
 */
export async function fetchAllDataFiles(projectId: string): Promise<RecentDataFile[]> {
    await requireRead(projectId, "data");

    const files = await prisma.dataFile.findMany({
        where: {
            source: {
                projectId: projectId,
            },
        },
        orderBy: {
            createdAt: "desc",
        },
        select: {
            id: true,
            name: true,
            createdAt: true,
            filePath: true,
        },
    });

    return files.map((file) => ({
        id: file.id,
        name: file.name,
        uploadedAt: file.createdAt,
        filePath: file.filePath,
    }));
}