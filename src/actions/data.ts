"use server"

import { createDataInputSchema } from "@/lib/validation-schemas/data";
import { authedProcedure } from "@/lib/zsa-procedures";
import { putObject } from "@/lib/storage";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { v4 as uuidv4 } from 'uuid';


export type FormState = {
    message: string;
    fields?: Record<string, string>;
    issues?: string[];
};

export const createData = authedProcedure
    .createServerAction()
    .input(createDataInputSchema, {
        type: "formData"
    })
    .handler(async ({ input, ctx }) => {
        const { sourceTypeId, destination = "MANUAL" } = input;
        const { user, prisma } = ctx;

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

        // Validate each fields
        sourceType.fields.forEach((field) => {
            if (!input[`fields[${field.id}]`]) {
                throw new Error(`Field ${field.label} is required`);
            }

            if (field.type === "FILE" && !(input[`fields[${field.id}]`] instanceof File)) {
                throw new Error(`Field ${field.label} must be a file`);
            }

            if (field.type === "STRING" && typeof input[`fields[${field.id}]`] !== "string") {
                throw new Error(`Field ${field.label} must be a string`);
            }
        });

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

        for (const field of sourceType.fields) {
            if (field.type === "FILE") {
                // Write the file to object storage
                const file = input[`fields[${field.id}]`];
                const extension = file.name.split('.').pop()?.toLocaleLowerCase();
                const fileUuid = uuidv4();
                const fileName = `${fileUuid}.${extension}`;

                 // Built conditionally so an empty sub-directory does not yield a double
                // slash. No leading slash: this is a storage key (see note above), not a
                // public URL.
                const storageKey = uploadSubdir
                    ? `uploads/${uploadSubdir}/${fileName}`
                    : `uploads/${fileName}`;

                const arrayBuffer = await file.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);

                await putObject(storageKey, buffer, file.type || "application/octet-stream");

                // Store metadata for DataFile creation
                const isImage = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff', 'svg', 'dzi'].includes(extension || '');
                const isZip = extension === 'zip';

                uploadedFiles.push({
                    fieldId: field.id,
                    filePath: storageKey,
                    fileName: file.name,
                    extension: extension || '',
                    isImage: isImage && !isZip
                });
            }
        }

        const uploadedFileByFieldId = new Map(
            uploadedFiles.map((f)=> [f.fieldId, f.filePath])
        );

        const fields = sourceType.fields.map((field) => {
            const value =
                field.type === "FILE"
                    ? uploadedFileByFieldId.get(field.id)!
                    : (input[`fields[${field.id}]`] as string);

            return {
                fieldId: field.id,
                value,
            };
        });

        // Now we can create the data
        const source = await prisma.source.create({
            data: {
                name: "New data",
                sourceTypeId,
                projectId: project.id,
                status: "PENDING",
                fields: {
                    create: fields,
                },
            }
        });  

        // Create DataFile only for image files (not ZIP)
        for (const fileInfo of uploadedFiles) {
            if (fileInfo.isImage) {
                // Determine file type based on extension
                let fileType: "IMAGE" | "DEEP_ZOOM_IMAGE" = "IMAGE";
                if (fileInfo.extension === 'dzi') {
                    fileType = "DEEP_ZOOM_IMAGE";
                }

                await prisma.dataFile.create({
                    data: {
                        sourceId: source.id,
                        name: fileInfo.fileName,
                        filePath: fileInfo.filePath,
                        type: fileType,
                        destination: destination as "MANUAL" | "ML" | "HEADWORK",
                    }
                });
            }
        }

        revalidatePath(`/projects/${project.slug}/data`);
        redirect(`/projects/${project.slug}/data`)
    })