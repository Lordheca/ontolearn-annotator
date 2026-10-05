// Upload rules shared by the upload form and the data server actions

export const MAX_BATCH_IMAGES = 10;

export const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "bmp", "webp", "tiff", "svg", "dzi"];

export function extensionOf(fileName: string): string {
    return fileName.split(".").pop()?.toLowerCase() ?? "";
}

export function isImageFileName(fileName: string): boolean {
    return IMAGE_EXTENSIONS.includes(extensionOf(fileName));
}