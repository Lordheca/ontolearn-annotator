export type Project = {
    id: string;
    name: string;
    slug: string;
    description: string;
    visibility: "PUBLIC" | "PRIVATE";
    createdAt: string;
    updatedAt: string;
}

export type ErrorResponse = {
    message: string;
    errors?: {
        [key: string]: string[];
    };
}

export type ProjectMember = {
    id?: string;
    role: string;
    user: {
        id?: string;
        name?: string;
        email: string;
    },
    project?: {
        id?: string;
        name?: string;
        slug: string;
    }
}