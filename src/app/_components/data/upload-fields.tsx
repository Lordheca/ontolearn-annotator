import { createDataInputSchema } from "@/lib/validation-schemas/data";
import { SourceTypeField } from "@prisma/client";
import { FieldArrayWithId, useForm } from "react-hook-form";
import { z } from "zod";
import { FormControl, FormField, FormItem, FormLabel } from "../ui/form";
import { Input } from "../ui/input";

export type Props = {
    formFields: any[],
    fields: SourceTypeField[],
    form: ReturnType<typeof useForm<z.infer<typeof createDataInputSchema>>>
}

export default function UploadFields({ formFields, fields, form }: Props) {
    return (
        <>
            {formFields.map((formField, index) => {
                return (
                    <FormField
                        control={form.control}
                        name={`fields.${index}.value`}
                        key={formField.id}
                        render={() => {
                            const fieldType = fields.find((field) => field.id === formField.id)?.type;
                            return (
                                <FormItem>
                                    <FormLabel>{fields.find((field) => field.id === formField.id)?.label}</FormLabel>
                                    <FormControl>
                                        <Input
                                            type={fieldType === "STRING" ? "text" : "file"}
                                            multiple={fieldType === "FILE"}
                                            {...form.register(`fields.${index}.value`)}
                                        />
                                    </FormControl>
                                </FormItem>
                            );
                        }}
                    />
                )
            })}
        </>
    )
}