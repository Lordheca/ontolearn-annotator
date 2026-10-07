import { describe, it, expect } from "vitest";
import { predictionBodySchema, resolveLabelCodes } from "../predictions";
import {
  parseWithoutPredictionQuery,
  whereWithoutPrediction,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
} from "../predictions";

const query = (text: string) => parseWithoutPredictionQuery(new URLSearchParams(text));

describe("parseWithoutPredictionQuery", () => {
  it("uses the default limit when none is given", () => {
    expect(query("withoutPrediction=epp26-v1")).toEqual({
      ok: true,
      modelVersion: "epp26-v1",
      limit: DEFAULT_LIST_LIMIT,
    });
  });

  it("trims the model version", () => {
    expect(query("withoutPrediction=%20epp26-v1%20")).toMatchObject({ modelVersion: "epp26-v1" });
  });

  it("requires a model version", () => {
    expect(query("").ok).toBe(false);
    expect(query("withoutPrediction=").ok).toBe(false);
    expect(query("withoutPrediction=%20%20").ok).toBe(false);
  });

  it("rejects a model version longer than 50 characters", () => {
    expect(query(`withoutPrediction=${"v".repeat(50)}`).ok).toBe(true);
    expect(query(`withoutPrediction=${"v".repeat(51)}`).ok).toBe(false);
  });

  it("accepts a limit and caps it at the maximum", () => {
    expect(query("withoutPrediction=v1&limit=10")).toMatchObject({ limit: 10 });
    expect(query("withoutPrediction=v1&limit=5000")).toMatchObject({ limit: MAX_LIST_LIMIT });
  });

  it("rejects a limit that is not a positive integer", () => {
    for (const limit of ["0", "-1", "abc", "1.5", ""]) {
      expect(query(`withoutPrediction=v1&limit=${limit}`).ok).toBe(false);
    }
  });
});

describe("whereWithoutPrediction", () => {
  it("selects images of the project without an ML annotation of that version", () => {
    expect(whereWithoutPrediction("project-1", "epp26-v1")).toEqual({
      type: "IMAGE",
      source: { projectId: "project-1" },
      annotations: { none: { author: "ML", modelVersion: "epp26-v1" } },
    });
  });
});

describe("predictionBodySchema", () => {
  const body = (labels: unknown, modelVersion: unknown = "epp26-v1") =>
    predictionBodySchema.safeParse({ modelVersion, labels });
  const label = (code: string, confidence = 0.5) => ({ code, confidence });

  it("accepts 1 to 3 labels", () => {
    expect(body([label("1.4")]).success).toBe(true);
    expect(body([label("1.4"), label("1.7.3"), label("1.1")]).success).toBe(true);
  });

  it("rejects no labels and more than 3", () => {
    expect(body([]).success).toBe(false);
    expect(body([label("1"), label("2"), label("3"), label("4")]).success).toBe(false);
  });

  it("rejects a confidence outside 0..1 or that is not a number", () => {
    expect(body([label("1.4", 1.01)]).success).toBe(false);
    expect(body([label("1.4", -0.1)]).success).toBe(false);
    expect(body([{ code: "1.4", confidence: "0.5" }]).success).toBe(false);
  });

  it("rejects a repeated code", () => {
    expect(body([label("1.4"), label("1.4", 0.2)]).success).toBe(false);
  });

  it("rejects a missing, empty or too long model version", () => {
    expect(body([label("1.4")], "").success).toBe(false);
    expect(predictionBodySchema.safeParse({ labels: [label("1.4")] }).success).toBe(false);
    expect(body([label("1.4")], "v".repeat(51)).success).toBe(false);
  });
});

describe("resolveLabelCodes", () => {
  const classTypes = [
    { id: "class-a", code: "1.4" },
    { id: "class-b", code: "1.7.3" },
    { id: "class-c", code: null },
  ];

  it("maps every code to its class, keeping order and confidence", () => {
    expect(
      resolveLabelCodes(
        [
          { code: "1.7.3", confidence: 0.7 },
          { code: "1.4", confidence: 0.2 },
        ],
        classTypes
      )
    ).toEqual({
      ok: true,
      labels: [
        { classTypeId: "class-b", confidence: 0.7 },
        { classTypeId: "class-a", confidence: 0.2 },
      ],
    });
  });

  it("reports every unknown code", () => {
    expect(
      resolveLabelCodes(
        [
          { code: "1.4", confidence: 0.7 },
          { code: "9.9", confidence: 0.2 },
          { code: "8.8", confidence: 0.1 },
        ],
        classTypes
      )
    ).toEqual({ ok: false, unknownCodes: ["9.9", "8.8"] });
  });
});