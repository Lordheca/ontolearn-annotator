import { Button } from "@/app/_components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/app/_components/ui/card";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { UploadImageForm } from "./upload-image-form";

type Props = {
    project: {
        id: string;
        icon: string;
    },
    readOnly?: boolean;
}

export default function UploadImageCard({ project, readOnly = true }: Props) {
    const t = useTranslations("Project.Icon");

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('iconUpload')}</CardTitle>
            </CardHeader>
            <CardContent>
                {project.icon && (
                    <div className="flex flex-col items-center justify-center">
                        <Image
                            src={`/api/icons/${project.icon}`}
                            width="150"
                            height="150"
                            alt="Current icon"
                            className="overflow-hidden rounded-md object-cover transition-all hover:scale-105 aspect-square mb-4"
                        />
                        <div className="space-y-1 text-sm mb-4">
                            <h3 className="font-medium leading-none">{t('current')}</h3>
                        </div>
                    </div>
                )}
                <UploadImageForm formId="upload-image" projectId={project.id} />
            </CardContent>
            <CardFooter className="border-t px-6 py-4 flex justify-end">
                <Button form="upload-image" type="submit" disabled={readOnly}>{t('submit')}</Button>
            </CardFooter>
        </Card>
    )
}