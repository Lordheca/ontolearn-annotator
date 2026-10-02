"use server"

import { createDataInputSchema, destinationSchema } from "@/lib/validation-schemas/data";
import { authedProcedure } from "@/lib/zsa-procedures";
import { putObject, deleteObject } from "@/lib/storage";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { v4 as uuidv4 } from 'uuid';
import { SourceStatus } from "@prisma/client";

export type FormState = {
    message: string;
    fields?: Record<string, string>;
    issues?: string[];
};


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
        const MAX_BATCH_IMAGES = 10;
        const IMAGE_EXTENTIONS = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff', 'svg', 'dzi'];
        const extensionOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

        // Change:  A FILE field can now hold several files and always work with an array

        const filesOf = (fieldId: string) : File[] => {
            console.log("filesOf", fieldId, input[`fields[${fieldId}]`]); // TEMP
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
        let imageCount = 0;

        for (const field of sourceType.fields) { 
            if (field.type !== "FILE") continue;
            const files = filesOf(field.id);
            if (files.length === 0) throw new Error (`Field ${field.label} is required`);

            const images = files.filter((f) => IMAGE_EXTENTIONS.includes(extensionOf(f.name)));
            if (files.length > 1 && images.length !== files.length) {
                throw new Error(`Field ${field.label}: several files must all be images. Upload a zip on its own.`);
            }
            imageCount += images.length;
        }  
        if (imageCount > MAX_BATCH_IMAGES) {
            throw new Error(`Up to ${MAX_BATCH_IMAGES} images per upload. For larger sets, upload a zip.`);
        }

        /*sourceType.fields.forEach((field) => {
            if (!input[`fields[${field.id}]`]) {
                throw new Error(`Field ${field.label} is required`);
            }

            if (field.type === "FILE" && !(input[`fields[${field.id}]`] instanceof File)) {
                throw new Error(`Field ${field.label} must be a file`);
            }

            if (field.type === "STRING" && typeof input[`fields[${field.id}]`] !== "string") {
                throw new Error(`Field ${field.label} must be a string`);
            }
        });*/

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
                        isImage: IMAGE_EXTENTIONS.includes(extension),
                    });
                }
            }
            /*for (const field of sourceType.fields) {
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
            }*/

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
            /*

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

            */

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