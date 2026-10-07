// Machine API for ML predictions (inference worker, ticket 4).
// Pure helpers: no Prisma client is imported, only its types.
import type { Prisma } from "@prisma/client";

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