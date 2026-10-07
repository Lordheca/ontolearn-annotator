import { describe, it, expect } from "vitest";
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