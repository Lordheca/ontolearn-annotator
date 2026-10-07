// Machine API for ML predictions (inference worker, ticket 4).
// Pure helpers: no Prisma client is imported, only its types.
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { MAX_ML_LABELS } from "./annotations";

export const MODEL_VERSION_MAX_LENGTH = 50;
export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 200;

export type WithoutPredictionQuery =
  | { ok: true; modelVersion: string; limit: number }
  | { ok: false; error: string };

/**
 * Reads ?withoutPrediction=<modelVersion>&limit=<n>.
 * The model version is required; limit defaults to 50 and is capped at 200.
 */
export function parseWithoutPredictionQuery(params: URLSearchParams): WithoutPredictionQuery {
  const modelVersion = (params.get("withoutPrediction") ?? "").trim();
  if (!modelVersion || modelVersion.length > MODEL_VERSION_MAX_LENGTH) {
    return {
      ok: false,
      error: `Query parameter 'withoutPrediction' must be a model version of 1 to ${MODEL_VERSION_MAX_LENGTH} characters`,
    };
  }

  const rawLimit = params.get("limit");
  if (rawLimit === null) {
    return { ok: true, modelVersion, limit: DEFAULT_LIST_LIMIT };
  }
  if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1) {
    return { ok: false, error: "Query parameter 'limit' must be a positive integer" };
  }
  return { ok: true, modelVersion, limit: Math.min(Number(rawLimit), MAX_LIST_LIMIT) };
}

/**
 * Images of a project that this model version has not classified yet.
 * Expert and annotator annotations do not count, and neither do predictions of
 * another model version: a new version classifies every image again.
 */
export function whereWithoutPrediction(
  projectId: string,
  modelVersion: string
): Prisma.DataFileWhereInput {
  return {
    type: "IMAGE",
    source: { projectId },
    annotations: { none: { author: "ML", modelVersion } },
  };
}

/** Body of POST …/data-files/[dataFileId]/predictions. */
export const predictionBodySchema = z.object({
  modelVersion: z.string().trim().min(1).max(MODEL_VERSION_MAX_LENGTH),
  labels: z
    .array(
      z.object({
        code: z.string().trim().min(1),
        confidence: z.number().min(0).max(1),
      })
    )
    .min(1)
    .max(MAX_ML_LABELS)
    .refine((labels) => new Set(labels.map((l) => l.code)).size === labels.length, {
      message: "Each class code can appear only once",
    }),
});

export type PredictionBody = z.infer<typeof predictionBodySchema>;

export type ResolvedLabels =
  | { ok: true; labels: { classTypeId: string; confidence: number }[] }
  | { ok: false; unknownCodes: string[] };

/**
 * Maps the codes of a prediction to the project's classes. `classTypes` is the list
 * of ACTIVE classes of the project; a code that is not in it is reported, never guessed.
 */
export function resolveLabelCodes(
  labels: PredictionBody["labels"],
  classTypes: { id: string; code: string | null }[]
): ResolvedLabels {
  const idByCode = new Map<string, string>();
  for (const classType of classTypes) {
    if (classType.code !== null) idByCode.set(classType.code, classType.id);
  }

  const unknownCodes = labels.filter((l) => !idByCode.has(l.code)).map((l) => l.code);
  if (unknownCodes.length > 0) {
    return { ok: false, unknownCodes };
  }
  return {
    ok: true,
    labels: labels.map((l) => ({ classTypeId: idByCode.get(l.code)!, confidence: l.confidence })),
  };
}