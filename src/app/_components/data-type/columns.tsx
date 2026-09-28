import { Button } from "@/app/_components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/app/_components/ui/dropdown-menu";
import { icons } from "@/lib/icons";
import { Prisma, SourceType } from "@prisma/client";
import { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "../ui/dialog";

export type Props = {
  translations: {
    delete: string;
    deleteTitle: string;
    deleteDescription: string;
    confirm: string;
  }
}

type SourceWithProject = Prisma.SourceTypeGetPayload<{
  include: {
    project: true;
  }
}>

export function getColumns({ translations }: Props): ColumnDef<SourceWithProject>[] {
  return [
    {
      accessorKey: "label",
      header: "label",
      cell: ({ row }) => {
        const icon = icons.find((icon) => icon.value === row.original.icon)
        if (!icon) return null

        return (
          <div className="flex items-center">
            <span className="mr-2">
              <icon.icon className="h-4 w-4" />
            </span>
            <span>{row.original.label}</span>
          </div>
        );
      }
    },
    {
      accessorKey: "name",
      header: "name",
    },
    {
      id: "actions",
      header: "actions",
      cell: ({ row }) => {
        const onClick = () => {
          console.log("Delete", row.original)
        }

        return (
          <Dialog>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 p-0">
                  <span className="sr-only">Open menu</span>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <Link href={`/projects/${row.original!.project.slug}/settings/source-types/${row.original.name}`}>
                  <DropdownMenuItem>
                    Edit
                  </DropdownMenuItem>
                </Link>
                <DialogTrigger asChild>
                  <DropdownMenuItem>
                    Delete
                  </DropdownMenuItem>
                </DialogTrigger>
              </DropdownMenuContent>
            </DropdownMenu>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Are you absolutely sure?</DialogTitle>
                <DialogDescription>
                  This action cannot be undone. Are you sure you want to permanently
                  delete this file from our servers?
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button type="submit" onClick={onClick}>{translations.confirm}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )
      }
    }
  ];
}