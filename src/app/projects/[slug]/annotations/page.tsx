import prisma from "@/lib/prisma";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { AnnotationsTableClient } from "@/app/_components/annotations/annotations-table-client";
// Goes through the service so a denied project:read becomes null -> notFound(), instead
// of the unguarded lookup this page used to do.
import { fetchProject } from "@/services/projects";

async function fetchDataFiles(projectId: string) {
  return prisma.dataFile.findMany({
    where: {
      source: {
        projectId,
      },
      type: { in: ["IMAGE", "DEEP_ZOOM_IMAGE"] },
    },
    include: {
      annotations: {
        include: {
          annotationTypes: {
            include: { classType: true },
          },
          areaOfInterest: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}


export default async function AnnotationsPage({ params }: { params: { slug: string } }) {
  const { slug } = params;
  const project = await fetchProject({ slug });
  if (!project) {
    return notFound();
  }
  const projectId = project.id;

  const allDataFiles = await fetchDataFiles(projectId);

  if (!allDataFiles) return notFound();

  // The table's counts, status, authors and previews mean "annotated by a person".
  // Expert and ML annotations are loaded too (the category columns will read them),
  // but are kept out of what the existing table logic sees.
  const dataFiles = allDataFiles.map((dataFile) => ({
    ...dataFile,
    annotations: dataFile.annotations.filter((annotation) => annotation.author === "USER"),
  }));

  return (
    <AnnotationsPageContent slug={slug} dataFiles={dataFiles} projectName={project.name} />
  );
}

function AnnotationsPageContent({ slug, dataFiles, projectName }: { slug: string; dataFiles: any; projectName: string }) {
  const t = useTranslations("Annotations");

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">{t("title")}</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">{t("subtitle", { projectName })}</p>
      </div>

      <AnnotationsTableClient slug={slug} dataFiles={dataFiles} />
    </div>
  );
}
