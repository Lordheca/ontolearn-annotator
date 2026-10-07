"use client"

import { Source, SourceStatus } from "@prisma/client";
import { ColumnDef } from "@tanstack/react-table";
import { Loader2 } from "lucide-react";
import { Badge } from "../ui/badge";
import { useTranslations } from "next-intl";

// Written by upload.py into Source.statusInfo.labels for an annotated zip.
type LabelsSummary = {
    stored: number;
    unknownCode: number;
    notInZip: number;
    withoutLabel: number;
    notApplied: number;
};

// statusInfo is free JSON: read it defensively, a missing count is 0.
function readLabelsSummary(statusInfo: unknown): LabelsSummary | null {
    if (!statusInfo || typeof statusInfo !== "object") return null;
    const labels = (statusInfo as { labels?: unknown }).labels;
    if (!labels || typeof labels !== "object") return null;

    const values = labels as Record<string, unknown>;
    const count = (key: string) => (typeof values[key] === "number" ? (values[key] as number) : 0);
    return {
        stored: count("stored"),
        unknownCode: count("unknownCode"),
        notInZip: count("notInZip"),
        withoutLabel: count("withoutLabel"),
        notApplied: count("notApplied"),
    };
}

function LabelsSummaryCell({ statusInfo }: { statusInfo: unknown }) {
    const t = useTranslations("Source.Labels");
    const summary = readLabelsSummary(statusInfo);
    if (!summary) {
        return <span className="text-muted-foreground">—</span>;
    }

    const details: string[] = [];
    if (summary.unknownCode > 0) details.push(t("unknownCode", { count: summary.unknownCode }));
    if (summary.withoutLabel > 0) details.push(t("withoutLabel", { count: summary.withoutLabel }));
    if (summary.notApplied > 0) details.push(t("notApplied", { count: summary.notApplied }));
    if (summary.notInZip > 0) details.push(t("notInZip", { count: summary.notInZip }));

    return (
        <div>
            <div>{t("stored", { count: summary.stored })}</div>
            {details.length > 0 && (
                <div className="text-sm text-muted-foreground">{details.join(" · ")}</div>
            )}
        </div>
    );
}

export const sourceColumns: ColumnDef<Source>[] = [
    {
        accessorKey: "name",
        header: "name",
    },
    {
        accessorKey: "status",
        header: "status",
        cell: ({ row }) => {
            const status: SourceStatus = row.getValue("status");

            switch (status) {
                case "PENDING":
                    return <Badge variant="outline">Pending</Badge>;
                case "PROCESSING":
                    return (
                        <Badge variant="outline">
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Processing
                        </Badge>
                    )
                    break;
                case "COMPLETED":
                    return <Badge>Completed</Badge>;
                case "FAILED":
                    return <Badge variant="destructive">Failed</Badge>;
                default:
                    return <Badge variant="secondary">{status}</Badge>;
            }
        },
    },
    {
        accessorKey: "statusInfo",
        header: "labels",
        cell: ({ row }) => <LabelsSummaryCell statusInfo={row.original.statusInfo} />,
    },
    {
        accessorKey: "uploadedAt",
        header: 'uploadedAt',
        cell: ({ row }) => {
            const date: Date = row.getValue("uploadedAt");
            const dateFormatter = new Intl.DateTimeFormat("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
                hour: "numeric",
                minute: "numeric",
                second: "numeric",
            });

            return <div>{dateFormatter.format(date)}</div>;
        },
    },
]
