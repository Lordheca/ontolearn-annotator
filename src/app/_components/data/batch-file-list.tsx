"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { MAX_BATCH_IMAGES, isImageFileName } from "@/lib/upload-limits";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export type BatchItem = { file: File; classTypeId: string };

export type ClassOption = { id: string; name: string; code: string | null };

type Props = {
    items: BatchItem[];
    onItemsChange: (items: BatchItem[]) => void;
    zipFile: File | null;
    onZipChange: (file: File | null) => void;
    classTypes: ClassOption[];
    disabled?: boolean;
};

// File picker for ticket 06

export default function BatchFileList({ items, onItemsChange, zipFile, onZipChange, classTypes, disabled }: Props) {
    const t = useTranslations("Data.Form");
    const [message, setMessage] = useState<string | null>(null);
    const [previews, setPreviews] =  useState<string[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);

    const fileKey = items.map((item) => `${item.file.name}:${item.file.size}:${item.file.lastModified}`).join("|");
    useEffect(() => {
        const urls = items.map((item) => URL.createObjectURL(item.file));
        setPreviews(urls);
        return () => urls.forEach((url) => URL.revokeObjectURL(url));
    }, [fileKey]);

    const addFiles = (chosen: FileList | null) => {
        if (!chosen) return;
        const list = Array.from(chosen);
        const zips = list.filter((file) => file.name.toLowerCase().endsWith(".zip"));

        if (zips.length > 0 || zipFile) {
            if (zips.length === 1 && list.length === 1 && items.length === 0 && !zipFile) {
                onZipChange(zips[0]);
                setMessage(null);
            } else {
                setMessage(t("batchZipAlone"));
            }
            if (inputRef.current) inputRef.current.value = "";
            return;
        }
        const images = list.filter((file) => isImageFileName(file.name));
        const notImages = list.filter((file) => !isImageFileName(file.name));

        if (items.length + images.length > MAX_BATCH_IMAGES) {
            setMessage(t("batchTooMany", { max: MAX_BATCH_IMAGES}));
        } else {
            onItemsChange([...items, ...images.map((file) => ({ file, classTypeId: "" }))]);
            setMessage(
                notImages.length > 0
                    ? t("batchNotImage", { names: notImages.map((file) => file.name).join(", ") })
                    : null
            );
        }

        if (inputRef.current) inputRef.current.value = "";
    };

    const removeAt = (index: number) => {
        onItemsChange(items.filter((_, i) => i !== index));
        setMessage(null);
    };


    const setCategory = (index: number, classTypeId: string) => {
        onItemsChange(items.map((item, i) => (i === index ? {...item, classTypeId } : item)));
    };

    return (
        <div className="space-y-3">
            <label className="text-sm font-medium">{t("batchSelect")}</label>
            <Input
                ref={inputRef}
                type="file"
                multiple
                accept="image/*,.zip"
                disabled={disabled}
                onChange={(event) => addFiles(event.target.files)}
            />
            <p className="text-sm text-muted-foreground">
                {t("batchHint", { max: MAX_BATCH_IMAGES })}
            </p>
            {message && <p className="text-sm text-destructive">{message}</p>}
            {zipFile &&  (
                <div className="flex items-center gap-3 rounded-md border p-2">
                    <span className="flex-1 truncate text-sm">{zipFile.name}</span>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={disabled}
                        onClick={() => {
                            onZipChange(null);
                            setMessage(null);
                        }}
                        aria-label={t("batchRemove")}
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </div>
            )}

            {items.length > 0 && (
                <ul className="divide-y rounded-md border">
                    {items.map((item, index) => (
                        <li key={`${item.file.name}-${index}`} className="flex items-center gap-3 p-2">
                            {previews[index] && (
                                <img src={previews[index]} alt="" className="h-12 w-12 rounded object-cover" />
                            )}
                            <span className="flex-1 truncate text-sm">{item.file.name}</span>
                            {}
                            {classTypes.length > 0 && (
                                <select
                                    className="h-9 max-w-[45%] rounded-md border bg-background px-2 text-sm"
                                    value={item.classTypeId}
                                    disabled={disabled}
                                    onChange={(event) => setCategory(index, event.target.value)}
                                    aria-label={t("batchExpertCategory")}
                                    title={t("batchExpertCategory")}
                                >
                                    <option value="">{t("batchNoCategory")}</option>
                                    {classTypes.map((classType) => (
                                        <option key={classType.id} value={classType.id}>
                                            {classType.code ? `${classType.code} ${classType.name}` : classType.name}
                                        </option>
                                    ))}
                                </select>
                            )}

                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                disabled={disabled}
                                onClick={() => removeAt(index)}
                                aria-label={t("batchRemove")}
                            >
                                <X className="h-4 w-4" />
                            </Button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}