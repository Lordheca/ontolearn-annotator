import prisma from "@/lib/prisma";
import { requireRead } from "@/lib/abac-guards";

export type HeaderStatistics = {
    accuracy: {
        value: number;
    };
    data: {
        value: number;
    };
    annotatedData: {
        value: number;
    };
    users: {
        value: number;
    };
}

export async function fetchHeaderStatistics(projectId: string): Promise<HeaderStatistics> {
    // Check permission to read statistics
    await requireRead(projectId, "statistics");

    const numberOfUsers = await prisma.projectMember.count({
        where: {
            projectId: projectId
        }
    })

    // Counts DataFile, not the older Data model: uploads made through the UI land in
    // DataFile (under a Source), so this tile used to read 0 for a project that had
    // files. Data is still what /api/v1/.../data writes — see TODO.md.
    const numberOfData = await prisma.dataFile.count({
        where: {
            source: {
                projectId: projectId
            }
        }
    });

    // Was hardcoded to 0, so the tile could never show anything else.
    // "Annotated" means annotated by a person: an image that only has an expert
    // category or an ML suggestion is still waiting for annotation.
    const numberOfAnnotatedData = await prisma.dataFile.count({
        where: {
            source: {
                projectId: projectId
            },
            annotations: {
                some: { author: "USER"}
            }
        }
    });

    const accuracy = await prisma.statistics.findFirst({
        where: {
            projectId: projectId,
            epoch: {
                gte: 0
            }
        },
        orderBy: {
            epoch: 'desc'
        }
    });

    return {
        // The only ML-fed figure here: written by POST /api/v1/projects/[id]/statistics
        // during training, so it stays at 0 until a model has run.
        accuracy: {
            value: accuracy ? accuracy.accuracy : 0.0,
        },
        data: {
            value: numberOfData,
        },
        annotatedData: {
            value: numberOfAnnotatedData,
        },
        users: {
            value: numberOfUsers,
        }
    }
}