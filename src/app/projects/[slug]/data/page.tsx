


import ProjectBreadcrumb from "@/app/_components/common/project-breadcrumb";
import { columns } from "@/app/_components/data/columns";
import { DataTable } from "@/app/_components/data/data-table";
import { sourceColumns } from "@/app/_components/source/columns";
import SourceDataTable from "@/app/_components/source/data-table";
import { Button } from "@/app/_components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/app/_components/ui/tabs";
import { checkPermission } from "@/lib/abac-client";
import { fetchProject } from "@/services/projects";
import { fetchAllDataFiles } from "@/services/data";
import { Upload } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function DataPage({ params }: { params: { slug: string } }) {
    const t = await getTranslations("Data.List")

    const project = await fetchProject({
        slug: params.slug,
        args: {
            include: {
                sourceTypes: true,
                sources: true
            }
        }
    });

    if (!project) {
        notFound();
    }

    const canWriteData = await checkPermission(project.id, "data:write");
    // File Storage Remediation Plan follow-up (found during Step 9
    // verification, 2026-09-24): this tab used to render project.data --
    // the legacy Data model (content/preview inline strings, unrelated to
    // DataFile/storage.ts, flagged out of scope in the plan's model
    // clarification note). Its rows carry no real filePath, so every
    // download here 404'd against /api/files/[id] regardless of storage
    // backend -- pre-existing, not caused by Phase 2. Switched to the
    // actual DataFile rows the download link (columns.tsx) was written for.
    const dataFiles = await fetchAllDataFiles(project.id);

    return (
        <>
            <div className="mx-auto flex justify-between w-full max-w-6xl gap-2">
                <h1 className="text-3xl font-semibold">{t('title')}</h1>
                {project.sourceTypes.length > 0 && canWriteData ? (
                    <Button asChild>
                        <Link href={`/projects/${params.slug}/data/upload`}>
                            <Upload className="mr-2" />
                            {t('upload')}
                        </Link>
                    </Button>
                ) : (
                    <Button disabled>
                        <Upload className="mr-2" />
                        {t('upload')}
                    </Button>
                )}
            </div>
            <ProjectBreadcrumb project={project} page={t('title')} />
            <div className="mx-auto grid w-full max-w-6xl gap-2">

                <Tabs defaultValue="data">
                    <TabsList>
                        <TabsTrigger value="data">{t('data')}</TabsTrigger>
                        <TabsTrigger value="sources">{t('sources')}</TabsTrigger>
                    </TabsList>
                    <TabsContent value="data">
                        <DataTable columns={columns} data={dataFiles} />
                    </TabsContent>
                    <TabsContent value="sources">
                        <SourceDataTable columns={sourceColumns} data={project.sources} />
                    </TabsContent>
                </Tabs>
            </div>
        </>
    )
}
