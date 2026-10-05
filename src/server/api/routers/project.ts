import { z } from "zod";
import {
  createProjectInputSchema,
  updateUseHeadworkInputSchema,
} from "@/lib/validation-schemas/project";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { requireRead, requireWrite } from "@/lib/abac-guards";
import { sortByPosition } from "@/lib/class-types-order";

export const projectRouter = createTRPCRouter({
  create: protectedProcedure
    .input(createProjectInputSchema)
    .mutation(async ({ ctx, input }) => {
      // Check if slug is already taken
      const existingProject = await ctx.db.project.findUnique({
        where: {
          slug: input.slug,
        },
      });

      if (existingProject) {
        throw new Error("Slug is already taken");
      }

      const project = await ctx.db.project.create({
        data: {
          name: input.name,
          slug: input.slug,
          description: input.description,
          categories: {
            connect: input.categories.map((category) => {
              return { id: category };
            }),
          },
        },
      });

      // Assign the project to the user
      await ctx.db.projectMember.create({
        data: {
          projectId: project.id,
          userId: ctx.session.user.id,
          role: "ADMIN",
        },
      });

      return project;
    }),

  updateUseHeadwork: protectedProcedure
    .input(updateUseHeadworkInputSchema)
    .mutation(async ({ ctx, input }) => {
      // Check write permission for settings
      await requireWrite(input.id, "settings");

      // Check if the project exists
      const project = await ctx.db.project.findUnique({
        where: {
          id: input.id,
        },
      });

      if (!project) {
        throw new Error("Project not found");
      }

      return ctx.db.project.update({
        where: {
          id: input.id,
        },
        data: {
          useHeadwork: input.useHeadwork,
        },
      });
    }),

  // Get classification types for a project
  getClassTypes: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      // projectId comes straight from the client, so a session is not enough: this
      // returned any project's vocabulary to any logged-in user.
      await requireRead(input.projectId, "task");

      const classTypes = await ctx.db.classType.findMany({
        where: {
          projectId: input.projectId,
          status: 'ACTIVE',
        },
        orderBy: {
          name: 'asc',
        },
      });

      // Return in format expected by workflow: array of { value, label }
      return sortByPosition(classTypes).map((ct: any) => ({
        value: ct.name,
        label: ct.name,
      }));
    }),
});
