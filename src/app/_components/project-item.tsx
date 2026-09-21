import Image from "next/image"

import { cn, truncate } from "@/lib/utils"
import { Project } from "@prisma/client"
import Link from "next/link"

type Props = {
    project: Project
    aspectRatio?: "portrait" | "square"
    width: number
    height: number
    className?: string
} & React.ComponentPropsWithoutRef<"a">

export function ProjectItem({
    project,
    aspectRatio = "portrait",
    width,
    height,
    className,
    ...props
}: Props) {
    return (
        <Link href={`/projects/${project.slug}`} className={cn("space-y-3", className)} {...props}>
            <div className="overflow-hidden rounded-md">
                {project.icon ? (
                <Image
                    // src={project.img}
                    src={`/api/icons/${project.icon}`}
                    alt={project.name}
                    width={width}
                    height={height}
                    className={cn(
                        "h-auto w-auto object-cover transition-all hover:scale-105",
                        aspectRatio === "portrait" ? "aspect-[3/4]" : "aspect-square"
                    )}
                />
                ) : (
                    <div className="bg-gray-200 h-[150px] w-full">
                        <div className="flex h-full items-center justify-center">
                            <p className="text-muted-foreground">No image</p>
                        </div>
                    </div>
                )}
            </div>

            <div className="space-y-1 text-sm">
                <h3 className="font-medium leading-none">{project.name}</h3>
                <p className="text-xs text-muted-foreground">{truncate(project.description, 100)}</p>
            </div>
        </Link>
    )
}