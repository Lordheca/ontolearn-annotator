import prisma from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import { WorkflowAnnotator } from "@/app/_components/workflow/workflow-annotator";
import Link from "next/link";
import { auth } from "@/server/auth";
// Goes through the service so a denied project:read becomes null -> notFound().
import { fetchProject } from "@/services/projects";

async function fetchDataFile(projectId: string, dataFileId: string) {
  return prisma.dataFile.findFirst({
    where: {
      id: dataFileId,
      source: { projectId },
    },
  });
}

// Only annotations made by a person count as "already annotated". Expert categories
// and ML suggestions are also Annotation rows on the same image, and must not hide
// the Annotator.
async function fetchAnnotations(projectId: string, dataFileId: string) {
  return prisma.annotation.findMany({
    where: {
      dataFileId,
      author: "USER",
      dataFile: { source: { projectId } },
    },
  });
}


async function fetchWorkflowConfig(projectId: string): Promise<string | null> {
  const config = await prisma.configuration.findUnique({
    where: {
      projectId_type: {
        projectId,
        type: "annotation_workflow",
      },
    },
  });

  return (config?.settings as { workflow?: string })?.workflow || null;
}

export default async function AnnotateDataFilePage({ params }: { params: { slug: string; dataFileId: string } }) {
  const { slug, dataFileId } = params;
  
  // Check authentication
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  
  const project = await fetchProject({ slug });
  if (!project) {
    return notFound();
  }
  const dataFile = await fetchDataFile(project.id, dataFileId);
  const annotations = await fetchAnnotations(project.id, dataFileId);

  if (!dataFile || !dataFile.filePath) {
    return notFound();
  }

  // Fetch workflow configuration from database
  const workflowYaml = await fetchWorkflowConfig(project.id);

  // Use authenticated user's ID
  const userId = session.user.id;

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Annotate image</h1>
        <p className="text-gray-600">{dataFile.name}</p>
      </div>

      {annotations.length > 0 ? (
        <div className="mb-4 p-4 bg-yellow-100 border-l-4 border-yellow-500">
          <p className="text-yellow-800">
            Note: This data file has existing annotations. You can review in the annotation page.
          </p>
          <Link href={`/projects/${slug}/annotations/`} className="text-blue-600 underline">
            Go to Annotation Page
          </Link>
        </div>
      ) : (
      <WorkflowAnnotator
        projectId={project.id}
        projectSlug={slug}
        dataFileId={dataFileId}
        userId={userId}
        imageUrl={`/api/files/${dataFile.id}`} 
        workflowYaml={workflowYaml || undefined}
      />
      )}
    </div>
  );
}
