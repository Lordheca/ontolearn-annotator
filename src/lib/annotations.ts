// How the three kinds of image category are stored in the Annotation table.
//
//   Expert        author = EXPERT, no AreaOfInterest, one AnnotationType (rank 1). Never edited.
//   ML suggestion author = ML, no AreaOfInterest, up to 3 AnnotationTypes ranked by
//                 confidence, plus modelVersion. Never edited; a new model version adds
//                 another annotation.
//   Annotator     author = USER, written by POST /api/workflow/save. Not handled here.
//
// Only type imports from @prisma/client: summarizeCategories is pure, so this module
// can be imported from client components as well as from server code and scripts.
import type { Annotation, Prisma } from "@prisma/client";

/** A transaction client. A plain PrismaClient is accepted too. */
export type PrismaTx = Prisma.TransactionClient;

export const MAX_ML_LABELS = 3;

export class ExpertAnnotationExistsError extends Error {
  constructor(
    public readonly dataFileId: string,
    public readonly existingAnnotationId: string
  ) {
    super(`DataFile ${dataFileId} already has an expert annotation (${existingAnnotationId}).`);
    this.name = "ExpertAnnotationExistsError";
  }
}

/**
 * Creates the image-level EXPERT annotation of a DataFile.
 * Throws ExpertAnnotationExistsError if one already exists: an expert category is
 * source data and is never edited or replaced.
 *
 * The check is done here, inside the caller's transaction, because MySQL cannot
 * express "unique where author = EXPERT" as a partial index.
 */
export async function createExpertAnnotation(
  tx: PrismaTx,
  dataFileId: string,
  classTypeId: string
): Promise<Annotation> {
  const existing = await tx.annotation.findFirst({
    where: { dataFileId, author: "EXPERT" },
    select: { id: true },
  });
  if (existing) {
    throw new ExpertAnnotationExistsError(dataFileId, existing.id);
  }

  return tx.annotation.create({
    data: {
      dataFileId,
      author: "EXPERT",
      annotationTypes: { create: [{ classTypeId, rank: 1 }] },
    },
  });
}

/** What the class code sent with an upload turned out to be. */
export type ExpertCodeLookup =
  | { status: "ABSENT" }
  | { status: "FOUND"; code: string; classTypeId: string }
  | { status: "UNKNOWN"; code: string };

/**
 * Looks up the class code sent with an uploaded image (label file of a zip, or the
 * dropdown of a small batch). Any ACTIVE class of the project is accepted, parent or
 * leaf. An unknown code is reported, never guessed.
 */
export async function resolveExpertCode(
  db: Pick<PrismaTx, "classType">,
  projectId: string,
  rawCode: string | null | undefined
): Promise<ExpertCodeLookup> {
  const code = (rawCode ?? "").trim();
  if (!code) return { status: "ABSENT" };

  const classType = await db.classType.findFirst({
    where: { projectId, code, status: "ACTIVE" },
    select: { id: true, code: true },
  });
  if (!classType || classType.code === null) return { status: "UNKNOWN", code };

  // The stored code, not the received one: it is what goes into the object metadata.
  return { status: "FOUND", code: classType.code, classTypeId: classType.id };
}

/**
 * Creates one image-level ML annotation with up to 3 labels.
 * Labels are ranked by confidence (highest = rank 1), whatever order they arrive in;
 * Annotation.confidence holds the rank-1 confidence.
 *
 * Idempotent per (dataFileId, modelVersion): if that model version already predicted
 * this image, the existing annotation is returned unchanged.
 */
export async function createMlAnnotation(
  tx: PrismaTx,
  dataFileId: string,
  modelVersion: string,
  labels: { classTypeId: string; confidence: number }[]
): Promise<Annotation> {
  if (!modelVersion.trim()) {
    throw new Error("modelVersion is required for an ML annotation.");
  }
  if (labels.length < 1 || labels.length > MAX_ML_LABELS) {
    throw new Error(`An ML annotation takes 1 to ${MAX_ML_LABELS} labels, got ${labels.length}.`);
  }
  for (const label of labels) {
    if (!Number.isFinite(label.confidence) || label.confidence < 0 || label.confidence > 1) {
      throw new Error(`Confidence must be between 0 and 1, got ${label.confidence}.`);
    }
  }
  if (new Set(labels.map((l) => l.classTypeId)).size !== labels.length) {
    throw new Error("An ML annotation cannot list the same class twice.");
  }

  const existing = await tx.annotation.findFirst({
    where: { dataFileId, author: "ML", modelVersion },
  });
  if (existing) {
    return existing;
  }

  const ranked = [...labels].sort((a, b) => b.confidence - a.confidence);

  return tx.annotation.create({
    data: {
      dataFileId,
      author: "ML",
      modelVersion,
      confidence: ranked[0].confidence,
      annotationTypes: {
        create: ranked.map((label, index) => ({
          classTypeId: label.classTypeId,
          rank: index + 1,
          confidence: label.confidence,
        })),
      },
    },
  });
}

/**
 * The minimum summarizeCategories needs from an annotation. A Prisma Annotation loaded
 * with `annotationTypes: { include: { classType: true } }` satisfies it.
 * `code` is optional because ClassType.code only exists once the class-types import
 * ticket is applied.
 */
export type AnnotationWithTypes = {
  author: string;
  modelVersion?: string | null;
  createdAt: Date | string;
  annotationTypes: {
    rank: number;
    confidence?: number | null;
    classType: { name: string; code?: string | null };
  }[];
};

/** What the UI shows for one image. */
export type ImageCategories = {
  expert: { code: string | null; name: string } | null;
  /** The newest ML annotation, labels in rank order. */
  ml: {
    modelVersion: string;
    createdAt: Date;
    labels: { code: string | null; name: string; confidence: number }[];
  } | null;
};

/** Picks the expert category and the newest ML suggestion out of an image's annotations. */
export function summarizeCategories(annotations: AnnotationWithTypes[]): ImageCategories {
  const byRank = (a: { rank: number }, b: { rank: number }) => a.rank - b.rank;
  const time = (a: AnnotationWithTypes) => new Date(a.createdAt).getTime();

  const expertType = annotations
    .filter((a) => a.author === "EXPERT")
    .flatMap((a) => [...a.annotationTypes].sort(byRank).slice(0, 1))[0];

  const newestMl = annotations
    .filter((a) => a.author === "ML" && a.annotationTypes.length > 0)
    .sort((a, b) => time(b) - time(a))[0];

  return {
    expert: expertType
      ? { code: expertType.classType.code ?? null, name: expertType.classType.name }
      : null,
    ml: newestMl
      ? {
          modelVersion: newestMl.modelVersion ?? "",
          createdAt: new Date(newestMl.createdAt),
          labels: [...newestMl.annotationTypes].sort(byRank).map((t) => ({
            code: t.classType.code ?? null,
            name: t.classType.name,
            confidence: t.confidence ?? 0,
          })),
        }
      : null,
  };
}