"use server"

import { z } from "zod";
import { createDataInputSchema, destinationSchema } from "@/lib/validation-schemas/data";
import { authedProcedure } from "@/lib/zsa-procedures";
import { putObject, deleteObject } from "@/lib/storage";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { v4 as uuidv4 } from 'uuid';
import { PrismaClient, SourceStatus } from "@prisma/client";
import { MAX_BATCH_IMAGES, extensionOf, isImageFileName } from "@/lib/upload-limits";
import { checkPermission } from "@/lib/abac-client";
import { createExpertAnnotation } from "@/lib/annotations";

export type FormState = {
    message: string;
    fields?: Record<string, string>;
    issues?: string[];
};

function singleFileFieldId(sourceType: { fields: { id: string; type: string }[] }): string | null {
    const [only, ...rest] = sourceType.fields;
    return only && rest.length === 0 && only.type === "FILE" ? only.id : null;
}

async function storeImageSource(
    prisma: PrismaClient,
    project: { id: string },
    sourceTypeId: string,
    fieldId: string,
    file: File,
    opts?: { expertClassTypeId?: string; expertCode?: string | null }
): Promise<{ sourceId: string; dataFileId: string }> {
    const extension = extensionOf(file.name);
    const storageKey = `uploads/manual/${uuidv4()}.${extension}`;

    await putObject(storageKey, Buffer.from(await file.arrayBuffer()), file.type || "application/octet-stream");

    try {
        return await prisma.$transaction(async (tx) => {
            const source = await prisma.source.create({
                data: {
                    name: "New data",
                    sourceTypeId,
                    projectId: project.id,
                    status: "COMPLETED",
                    destination: "MANUAL",
                    fields: {create: [{ fieldId, value: storageKey }] },
                    dataFiles: {
                        create: [{
                            name: file.name,
                            filePath: storageKey,
                            type: extension === "dzi" ? "DEEP_ZOOM_IMAGE" : "IMAGE",
                            destination: "MANUAL",
                        }],
                    },
                },
                include: {dataFiles: { select: {id: true } } },
            });

            const dataFileId = source.dataFiles[0].id;
            if (opts?.expertClassTypeId) {
                await createExpertAnnotation(tx, dataFileId, opts.expertClassTypeId);
            }
            return { sourceId: source.id, dataFileId };
        });  
    } catch (error) {
        try {
            await deleteObject(storageKey);
        } catch (deleteError) {
            console.error(`Failed to delete orphaned object ${storageKey}:`, deleteError);
        }
        throw error;
    }
}
// Recieves raw form submission from the browser
export const createData = authedProcedure
    .createServerAction()
    .input(createDataInputSchema, {
        type: "formData"
    })
    .handler(async ({ input, ctx }) => {
        const { sourceTypeId } = input;
        const destination = destinationSchema.parse(input.destination ?? "MANUAL");

        const { user, prisma } = ctx;

        // Change:  A FILE field can now hold several files and always work with an array

        const filesOf = (fieldId: string) : File[] => {
            const raw = input[`fields[${fieldId}]`];
            const list = Array.isArray(raw) ? raw : [raw];
            return list.filter((v): v is File => v instanceof File && v.size > 0);
        };

        const sourceType = await prisma.sourceType.findUnique({
            where: {
                id: sourceTypeId
            },
            include: {
                fields: true
            }
        });

        if (!sourceType) {
            throw new Error("Source type not found");
        }

        sourceType.fields.forEach((field) => {
            if (field.type !== "STRING") return;
            if (!input[`fields[${field.id}]`]) {
                throw new Error(`Field ${field.label} is required`);
            }
            if (typeof input[`fields[${field.id}]`] !== "string") {
                throw new Error(`Field ${field.label} must be a string`);
            }
        });

        // Validate each fields
        for (const field of sourceType.fields) {
            if (field.type !== "FILE") continue;
            const files = filesOf(field.id);
            if (files.length === 0) throw new Error(`Field ${field.label} is required`);
            if (files.length > 1) {
                throw new Error(`Field ${field.label} accepts one file. For larger sets, upload a zip.`);
            }
        }

        const project = await prisma.project.findFirst({
            where: {
                sourceTypes: {
                    some: {
                        id: sourceTypeId
                    }
                }
            }
        });

        if (!project) {
            throw new Error("Project not found");
        }

        const singleFieldId = singleFileFieldId(sourceType);
        if (singleFieldId) {
            const files = filesOf(singleFieldId);
            if (files.length === 1 && isImageFileName(files[0].name)) {
                await storeImageSource(prisma, project, sourceTypeId, singleFieldId, files[0]);
                revalidatePath(`/projects/${project.slug}/data`);
                redirect(`/projects/${project.slug}/data`);
            }
        }


        // Determine upload sub-directory based on destination. Empty for anything but
        // MANUAL: "uploads" here was joined onto storage/uploads, so those files landed in
        // storage/uploads/uploads and were stored as uploads/uploads/<file>.
        //
        // File Storage Remediation Plan, Phase 1 Step 1: this used to write into
        // public/uploads, which Next.js serves statically to anyone with the URL, with no
        // permission check at all. It now writes into storage/uploads instead -- a
        // directory outside public/, not served by Next.js -- so a DataFile's bytes are
        // reachable only once Step 2's /api/files/[id] route (ABAC-gated) exists. filePath
        // is stored without a leading slash from here on: it is a storage key, not a URL a
        // browser can hit directly.
        //
        // File Storage Remediation Plan, Phase 2 Step 8: "storage/uploads" above is now
        // the object key prefix inside the MinIO bucket (storage.ts), not a local disk
        // path -- no local directory is created or written to here anymore.
        const uploadSubdir = destination === "MANUAL" ? "manual" : "";

        // Handle all file uploads
        const uploadedFiles: Array<{ fieldId: string; filePath: string; fileName: string; extension: string; isImage: boolean }> = [];
        try {
            for (const field of sourceType.fields) {
                if (field.type !== "FILE") continue;

                for (const file of filesOf(field.id)) {
                    const extension = extensionOf(file.name);
                    const fileName = `${uuidv4()}.${extension}`;

                    const storageKey = uploadSubdir
                        ? `uploads/${uploadSubdir}/${fileName}`
                        : `uploads/${fileName}`;
                    
                    const buffer = Buffer.from(await file.arrayBuffer());
                    await putObject(storageKey, buffer, file.type || "application/octet-stream");

                    uploadedFiles.push({
                        fieldId: field.id,
                        filePath: storageKey,
                        fileName: file.name,
                        extension,
                        isImage: isImageFileName(file.name),
                    });
                }
            }


            const hasFiles = uploadedFiles.length > 0;
            const allFilesBecameDataFiles = uploadedFiles.every((f) => f.isImage);
            const status: SourceStatus = hasFiles && allFilesBecameDataFiles ? "COMPLETED" : "PENDING";

            const fields: Array<{
                fieldId: string; value: string
            }> = [];

            for (const f of uploadedFiles) {
                fields.push({ fieldId: f.fieldId, value: f.filePath });
            }

            for (const field of sourceType.fields) {
                if (field.type === "STRING") {
                    fields.push({ fieldId: field.id, value: input[`fields[${field.id}]`] as string});
                }
            }

            await prisma.source.create({
                data: {
                    name: "New data",
                    sourceTypeId,
                    projectId: project.id,
                    status,
                    destination,
                    fields: {
                        create: fields,
                    },

                    // DataFiles only for image files, zips get theirs from upload.py
                    dataFiles: {
                        create: uploadedFiles
                            .filter((f) => f.isImage)
                            .map((f) => ({
                            name: f.fileName,
                            filePath: f.filePath,
                            type: f.extension === "dzi" ? ("DEEP_ZOOM_IMAGE" as const) : ("IMAGE" as const),
                            destination,
                        })),
                    },
                },
            });
        } catch (error) {
            for (const f of uploadedFiles) {
                try {
                    await deleteObject (f.filePath);
                } catch (deleteError) {
                    console.error(`Failed to delete orphaned object ${f.filePath}:`, deleteError);
                }
            }
            throw error;
        }
        

        revalidatePath(`/projects/${project.slug}/data`);
        redirect(`/projects/${project.slug}/data`)
    })

    const createImageBatchInput = z.object({
        sourceTypeId: z.string().min(1),
        files: z.union([z.instanceof(File), z.array(z.instanceof(File))]),
        expertClassTypeIds: z.union([z.string(), z.array(z.string())]).optional(),
    });

    export const createImageBatch = authedProcedure
        .createServerAction()
        .input(createImageBatchInput, {
            type: "formData"
        })
        .handler(async ({ input, ctx }) => {
            const { prisma } = ctx;

            const rawFiles = Array.isArray(input.files) ? input.files : [input.files];
            const rawClassIds = input.expertClassTypeIds === undefined
                ? []
                : Array.isArray(input.expertClassTypeIds) ? input.expertClassTypeIds : [input.expertClassTypeIds];
            
            if (rawClassIds.length > 0 && rawClassIds.length !== rawFiles.length) {
                throw new Error("Each image needs one category entry.");
            }

            const items = rawFiles
                .map((file, index) => ({ file, expertClassTypeId: rawClassIds[index] || undefined }))
                .filter((item) => item.file.size > 0);
            const files = items.map((item) => item.file);

            if (files.length === 0) {
                throw new Error("Choose at least one image.");
            }
            if (files.length > MAX_BATCH_IMAGES) {
                throw new Error (`Up to ${MAX_BATCH_IMAGES} images per upload. For larger sets, upload a zip.`);
            }
            const notImages = files.filter((file) => !isImageFileName(file.name));
            if (notImages.length > 0) {
                throw new Error(`Only images can be uploaded together. Not an image: ${notImages.map((file) => file.name).join(", ")}`);
            }

            const sourceType = await prisma.sourceType.findUnique({
                where: { id: input.sourceTypeId },
                include: { fields: true },
            });
            if (!sourceType) {
                throw new Error("Source type not found");
            }

            const fieldId = singleFileFieldId(sourceType);
            if (!fieldId) {
                throw new Error("This data type does not accept several images.");
            }

            const project = await prisma.project.findUnique({
                where: { id: sourceType.projectId },
            });
            if (!project) {
                throw new Error("Project not found");
            }

            if (!(await checkPermission(project.id, "data:write"))) {
                throw new Error("You do not have permission to upload data to this project.");
            }

            const chosenIds = Array.from(new Set(
                items.flatMap((item) => (item.expertClassTypeId ? [item.expertClassTypeId] : []))
            ));
            const chosenClasses = chosenIds.length === 0 ? [] : await prisma.classType.findMany({
                where: { id: { in: chosenIds }, projectId: project.id, status: "ACTIVE" },
                select: { id: true, code: true },
            });
            if (chosenClasses.length !== chosenIds.length) {
                throw new Error("One of the chosen categories is not an active label of this project.");
            }
            const codeByClassId = new Map(chosenClasses.map((c) => [c.id, c.code]));

            let uploaded = 0;
            const failed: Array<{ name: string; reason: string }>  = [];

            for (const { file, expertClassTypeId } of items) {
                try {
                    await storeImageSource(prisma, project, sourceType.id, fieldId, file, {
                        expertClassTypeId,
                        expertCode: expertClassTypeId ? codeByClassId.get(expertClassTypeId) ?? null : null,
                    });
                    uploaded++;
                } catch (error) {
                    console.error(`Batch upload: ${file.name} could not be stored:`, error);
                    failed.push({ name: file.name, reason: "Could not be stored. Try again." });
                }
            }

            if (uploaded > 0) {
                revalidatePath(`/projects/${project.slug}/data`);
            }

            return { uploaded, failed };
        })
    