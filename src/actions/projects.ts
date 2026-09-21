"use server";

import prisma from "@/lib/prisma";
import { uploadImageInputSchema } from "@/lib/validation-schemas/project-image";
import { canWriteSettings } from "@/lib/zsa-procedures";
import { deleteObject, putObject } from "@/lib/storage";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export const uploadImage = canWriteSettings
    .createServerAction()
    .input(uploadImageInputSchema, {
        type: "formData"
    })
    .handler(async ({ input, ctx }) => {
        const project = ctx.project;

        if (project.icon) {
            // Remove old image from database
            await prisma.project.update({
                where: {
                    id: project.id,
                },
                data: {
                    icon: null
                },
            });

            // Remove old image from the bucket. S3/MinIO's DeleteObject does not
            // error on a missing key (unlike fs.unlinkSync, which threw and used
            // to need the existsSync guard this replaces) -- the try/catch here
            // is only for a genuine failure (network, credentials), not a
            // does-it-exist check.
            try {
                await deleteObject(`icons/${project.icon}`);
            } catch (error) {
                console.error("Failed to delete old object icon from storage:", error);
            }
        }

        // Save new image to object storage. File Storage Remediation Plan,
        // Phase 2 Step 8: the icon write moves off local disk along with the
        // other two write sites -- §5.2 confirmed reads stay public, so it's
        // now served through the unauthenticated /api/icons/[filename] route
        // instead of a plain public/img/projects/ static file.
        const fileName = `${project.id}.png`;
        const icon: File = input.icon;

        try {
            const arrayBuffer = await icon.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            await putObject(`icons/${fileName}`, buffer, icon.type || "image/png");
        } catch (error) {
            throw new Error("Failed to save icon");
        }

        // Update project with new icon
        await prisma.project.update({
            where: {
                id: project.id,
            },
            data: {
                icon: fileName
            },
        });

        revalidatePath(`/projects`);
        revalidatePath(`/projects/${project.slug}/settings`);
        redirect(`/projects/${project.slug}/settings`);
    })