"use client";

import { createData } from "@/actions/data";
import { createDataInputSchema } from "@/lib/validation-schemas/data";
import { zodResolver } from "@hookform/resolvers/zod";
import { Prisma, Project } from "@prisma/client";
import { AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { redirect } from "next/navigation";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import { useServerAction } from 'zsa-react';
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "../ui/form";
import { SubmitButton } from "../ui/submit-button";
import { useToast } from "../ui/use-toast";
import SelectDataType from "./select-data-type";
import UploadFields from "./upload-fields";

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

    const onSubmit = form.handleSubmit(async (data) => {
        const formData = new FormData();
        formData.append('sourceTypeId', data.sourceTypeId); 
        formData.append('destination', data.destination);

        data.fields.forEach((field: any) => {
            if (field.value instanceof FileList) {
                // FILE field can hold several files, send them under the same key, createData reads them back as a list
                for (const file of Array.from(field.value as FileList)) {
                    formData.append(`fields[${field.id}]`, file);
                }
                return;
            }
            formData.append(`fields[${field.id}]`, field.value);
        });

        execute(formData);
    })

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
                <FormField
                    control={form.control}
                    name="destination"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Destination</FormLabel>
                            <FormControl>
                                <select
                                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    value={field.value}
                                    onChange={field.onChange}
                                >
                                    <option value="MANUAL">Manual Annotation</option>
                                    <option value="ML">Machine Learning</option>
                                    <option value="HEADWORK">Headwork</option>
                                </select>
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <UploadFields form={form} formFields={formFields} fields={fields} />
                <div className="flex justify-end">
                    <SubmitButton text={t('submit')} />
                </div>
            </form>
        </Form>
    )
}