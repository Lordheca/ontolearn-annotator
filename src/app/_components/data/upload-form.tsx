"use client";

import { createData, createImageBatch } from "@/actions/data";
import { createDataInputSchema } from "@/lib/validation-schemas/data";
import { zodResolver } from "@hookform/resolvers/zod";
import { Prisma, Project } from "@prisma/client";
import { AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { redirect, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import { useServerAction } from 'zsa-react';
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "../ui/form";
import { SubmitButton } from "../ui/submit-button";
import { useToast } from "../ui/use-toast";
import SelectDataType from "./select-data-type";
import UploadFields from "./upload-fields";
import BatchFileList, { BatchItem, ClassOption } from "./batch-file-list";
import { Button } from "../ui/button";

export type SourceTypeWithFields = Prisma.SourceTypeGetPayload<{
    include: {
        fields: true
    }
}>

export type Props = {
    project: Project;
    sourceTypes: SourceTypeWithFields[];
}

export default function UploadForm({ project, sourceTypes }: Props) {
    const { toast } = useToast();
    const t = useTranslations('Data.Form');
    const router = useRouter();

    const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
    const [classTypes, setClassTypes] = useState<ClassOption[]>([]);
    const [batchFailed, setBatchFailed] = useState<Array<{ name: string; reason: string }>>([]);

    const form = useForm<z.infer<typeof createDataInputSchema>>({
        resolver: zodResolver(createDataInputSchema),
        defaultValues: {
            sourceTypeId: '',
            destination: 'MANUAL',
            fields: []
        }
    })

    const { fields: formFields, remove, append } = useFieldArray({
        keyName: "key",
        control: form.control,
        name: 'fields'
    })

    const fields = sourceTypes.find((sourceType) => sourceType.id === form.getValues().sourceTypeId)?.fields || [];
    const selectedSourceType = sourceTypes.find((sourceType) => sourceType.id === form.watch('sourceTypeId'));
    const isBatch = selectedSourceType?.fields.length === 1 && selectedSourceType.fields[0].type === "FILE";

    useEffect(() => {
        if (!isBatch) return;
        let cancelled = false;
        fetch(`/api/projects/${project.slug}/class-types?status=ACTIVE`)
            .then ((response) => (response.ok ? response.json() : []))
            .then ((rows: ClassOption[]) => {
                if (!cancelled) setClassTypes(rows.map(({ id, name, code }) => ({ id, name, code})));
            })
            .catch(() => {
                if (!cancelled) setClassTypes([]);
            });
        return () => {
            cancelled = true;
        };
    }, [isBatch, project.slug]);

    const { execute, isPending, isError, error } = useServerAction(createData, {
        onError: ({ err }) => {
            if (!err.fieldErrors) return;

            const keys = Object.keys(err.fieldErrors) as Array<keyof typeof err.fieldErrors>;
            keys.forEach((key) => {
                const errorMessage = err.fieldErrors[key]?.join(' ');

                form.setError(key.toString(), {
                    type: 'custom',
                    message: errorMessage
                })
            })
        },
        onSuccess: () => {
            toast({
                title: t('dataUploaded')
            })
            redirect(`/projects/${project.slug}/data`)
        }
    });

    const batch = useServerAction(createImageBatch, {
        onSuccess: ({ data }) => {
            if (data.uploaded > 0) {
                toast({ title: t('batchUploaded', { count: data.uploaded }) });
            }
            if (data.failed.length > 0) {
                setBatchFailed(data.failed);
                setBatchItems((current) => current.filter((item) => data.failed.some((f) => f.name === item.file.name)));
                return;
            }
            router.push(`/projects/${project.slug}/data`);
        }
    });

    const submitData = form.handleSubmit(async (data) => {
        const formData = new FormData();
        formData.append('sourceTypeId', data.sourceTypeId); 
        formData.append('destination', data.destination);

        data.fields.forEach((field: any) => {
            if (field.value instanceof FileList) {
                for (const file of Array.from(field.value as FileList)) {
                    formData.append(`fields[${field.id}]`, file);
                }
                return;
            }
            formData.append(`fields[${field.id}]`, field.value);
        });

        execute(formData);
    })

    const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        if (!isBatch) {
            submitData(event);
            return;
        }
        event.preventDefault();
        if (batchItems.length === 0) return;

        const formData = new FormData();
        formData.append('sourceTypeId', form.getValues('sourceTypeId'));
        batchItems.forEach((item) => {
            formData.append('files', item.file);
            formData.append('expertClassTypeIds', item.classTypeId);
        });
        setBatchFailed([]);
        batch.execute(formData);
    };

    return (
        <Form {...form}>
            <form className="space-y-8" onSubmit={onSubmit}>
                {isError && (
                    <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>{t('errorOccurred')}</AlertTitle>
                        <AlertDescription>
                            {error.message}
                        </AlertDescription>
                    </Alert>
                )}
                {batch.isError && (
                    <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>{t('errorOccurred')}</AlertTitle>
                        <AlertDescription>{batch.error.message}</AlertDescription>
                    </Alert>
                )}
                {batchFailed.length > 0 && (
                    <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>{t('batchFailed')}</AlertTitle>
                        <AlertDescription>
                            <ul className="list-disc pl-5">
                                {batchFailed.map((f) => (
                                    <li key={f.name}>{f.name}: {f.reason}</li>
                                ))}
                            </ul>
                        </AlertDescription>
                    </Alert>
                )}
                <FormField
                    control={form.control}
                    name="sourceTypeId"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>{t('sourceType')}</FormLabel>
                            <FormControl>
                                <SelectDataType dataTypes={sourceTypes} value={field.value} onValueChange={(value) => {
                                    const fields = sourceTypes.find((sourceType) => sourceType.id === value)?.fields || [];
                                    remove()
                                    setBatchItems([]);
                                    setBatchFailed([]);
                                    fields.forEach((field) => {
                                        append({ id: field.id, value: '' })
                                    });
                                    field.onChange(value);
                                }} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                {isBatch ? (
                    <BatchFileList items={batchItems} onItemsChange={setBatchItems} classTypes={classTypes} disabled={batch.isPending} />
                ) : (
                    <UploadFields form={form} formFields={formFields} fields={fields} />
                )}
                <div className="flex justify-end">
                    {isBatch ? (
                        <Button type="submit" disabled={batchItems.length === 0 || batch.isPending}>
                            {t('submit')}
                        </Button>
                    ) : (
                        <SubmitButton text={t('submit')} />
                    )}
                </div>
            </form>
        </Form>
    )
}