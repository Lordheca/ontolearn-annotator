"use client"

import { Source, SourceStatus } from "@prisma/client";
import { ColumnDef } from "@tanstack/react-table";
import { Loader2 } from "lucide-react";
import { Badge } from "../ui/badge";

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
