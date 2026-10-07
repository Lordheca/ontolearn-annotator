import { describe, it, expect } from "vitest";
import {
  createExpertAnnotation,
  createMlAnnotation,
  summarizeCategories,
  ExpertAnnotationExistsError,
  type AnnotationWithTypes,
  type PrismaTx,
  resolveExpertCode,
} from "../annotations";

// In-memory stand-in for the two Prisma calls the helpers make.
function makeTx() {
  const rows: any[] = [];
  const tx = {
    annotation: {
      findFirst: async ({ where }: any) =>
        rows.find((row) => Object.keys(where).every((key) => row[key] === where[key])) ?? null,
      create: async ({ data }: any) => {
        const row = { id: `ann-${rows.length + 1}`, ...data };
        rows.push(row);
        return row;
      },
    },
  } as unknown as PrismaTx;
  return { tx, rows };
}

describe("createExpertAnnotation", () => {
  it("creates an image-level EXPERT annotation with one rank-1 class", async () => {
    const { tx, rows } = makeTx();
    await createExpertAnnotation(tx, "file-1", "class-a");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ dataFileId: "file-1", author: "EXPERT" });
    expect(rows[0].areaOfInterestId).toBeUndefined();
    expect(rows[0].annotationTypes.create).toEqual([{ classTypeId: "class-a", rank: 1 }]);
  });

  it("refuses a second expert annotation on the same image", async () => {
    const { tx, rows } = makeTx();
    await createExpertAnnotation(tx, "file-1", "class-a");

    await expect(createExpertAnnotation(tx, "file-1", "class-b")).rejects.toBeInstanceOf(
      ExpertAnnotationExistsError
    );
    expect(rows).toHaveLength(1);
  });

  it("allows expert annotations on different images", async () => {
    const { tx, rows } = makeTx();
    await createExpertAnnotation(tx, "file-1", "class-a");
    await createExpertAnnotation(tx, "file-2", "class-a");
    expect(rows).toHaveLength(2);
  });

  it("is not blocked by an ML annotation on the same image", async () => {
    const { tx, rows } = makeTx();
    await createMlAnnotation(tx, "file-1", "v1", [{ classTypeId: "class-a", confidence: 0.9 }]);
    await createExpertAnnotation(tx, "file-1", "class-a");
    expect(rows).toHaveLength(2);
  });
});

describe("createMlAnnotation", () => {
  const labels = [
    { classTypeId: "class-b", confidence: 0.2 },
    { classTypeId: "class-a", confidence: 0.6 },
    { classTypeId: "class-c", confidence: 0.1 },
  ];

  it("ranks labels by confidence and copies the top confidence to the annotation", async () => {
    const { tx, rows } = makeTx();
    await createMlAnnotation(tx, "file-1", "epp26-v1", labels);

    expect(rows[0]).toMatchObject({
      dataFileId: "file-1",
      author: "ML",
      modelVersion: "epp26-v1",
      confidence: 0.6,
    });
    expect(rows[0].annotationTypes.create).toEqual([
      { classTypeId: "class-a", rank: 1, confidence: 0.6 },
      { classTypeId: "class-b", rank: 2, confidence: 0.2 },
      { classTypeId: "class-c", rank: 3, confidence: 0.1 },
    ]);
  });

  it("is idempotent per image and model version", async () => {
    const { tx, rows } = makeTx();
    const first = await createMlAnnotation(tx, "file-1", "epp26-v1", labels);
    const second = await createMlAnnotation(tx, "file-1", "epp26-v1", labels);

    expect(rows).toHaveLength(1);
    expect(second.id).toBe(first.id);
  });

  it("keeps the old prediction when a new model version predicts the same image", async () => {
    const { tx, rows } = makeTx();
    await createMlAnnotation(tx, "file-1", "epp26-v1", labels);
    await createMlAnnotation(tx, "file-1", "epp26-v2", labels);
    expect(rows.map((row) => row.modelVersion)).toEqual(["epp26-v1", "epp26-v2"]);
  });

  it("rejects invalid input without writing", async () => {
    const { tx, rows } = makeTx();
    const one = { classTypeId: "class-a", confidence: 0.5 };

    await expect(createMlAnnotation(tx, "file-1", " ", [one])).rejects.toThrow(/modelVersion/);
    await expect(createMlAnnotation(tx, "file-1", "v1", [])).rejects.toThrow(/1 to 3 labels/);
    await expect(
      createMlAnnotation(tx, "file-1", "v1", [...labels, { classTypeId: "class-d", confidence: 0.05 }])
    ).rejects.toThrow(/1 to 3 labels/);
    await expect(
      createMlAnnotation(tx, "file-1", "v1", [{ classTypeId: "class-a", confidence: 1.2 }])
    ).rejects.toThrow(/between 0 and 1/);
    await expect(
      createMlAnnotation(tx, "file-1", "v1", [{ classTypeId: "class-a", confidence: NaN }])
    ).rejects.toThrow(/between 0 and 1/);
    await expect(createMlAnnotation(tx, "file-1", "v1", [one, one])).rejects.toThrow(/same class twice/);

    expect(rows).toHaveLength(0);
  });
});

describe("summarizeCategories", () => {
  const expert: AnnotationWithTypes = {
    author: "EXPERT",
    createdAt: new Date("2026-10-01T00:00:00Z"),
    annotationTypes: [{ rank: 1, classType: { name: "Beautiful", code: "1.7.3" } }],
  };
  const ml = (modelVersion: string, createdAt: string): AnnotationWithTypes => ({
    author: "ML",
    modelVersion,
    createdAt,
    annotationTypes: [
      { rank: 2, confidence: 0.2, classType: { name: "Polygonal", code: "1.5" } },
      { rank: 1, confidence: 0.6, classType: { name: "Beautiful", code: "1.7.3" } },
      { rank: 3, confidence: 0.1, classType: { name: "No crystal" } },
    ],
  });
  const user: AnnotationWithTypes = {
    author: "USER",
    createdAt: new Date("2026-10-03T00:00:00Z"),
    annotationTypes: [{ rank: 1, classType: { name: "Singular Irregular" } }],
  };

  it("returns nulls when there is nothing to show", () => {
    expect(summarizeCategories([])).toEqual({ expert: null, ml: null });
    expect(summarizeCategories([user])).toEqual({ expert: null, ml: null });
  });

  it("returns the expert category", () => {
    expect(summarizeCategories([user, expert]).expert).toEqual({ code: "1.7.3", name: "Beautiful" });
  });

  it("returns ML labels in rank order, with a null code when the class has none", () => {
    const result = summarizeCategories([ml("epp26-v1", "2026-10-02T00:00:00Z")]);
    expect(result.expert).toBeNull();
    expect(result.ml?.modelVersion).toBe("epp26-v1");
    expect(result.ml?.labels).toEqual([
      { code: "1.7.3", name: "Beautiful", confidence: 0.6 },
      { code: "1.5", name: "Polygonal", confidence: 0.2 },
      { code: null, name: "No crystal", confidence: 0.1 },
    ]);
  });

  it("picks the newest ML annotation, whatever the input order", () => {
    const older = ml("epp26-v1", "2026-10-02T00:00:00Z");
    const newer = ml("epp26-v2", "2026-10-05T00:00:00Z");
    expect(summarizeCategories([newer, older]).ml?.modelVersion).toBe("epp26-v2");
    expect(summarizeCategories([older, newer]).ml?.modelVersion).toBe("epp26-v2");
    expect(summarizeCategories([older, newer]).ml?.createdAt).toEqual(new Date("2026-10-05T00:00:00Z"));
  });

  it("does not mutate its input", () => {
    const input = [ml("epp26-v1", "2026-10-02T00:00:00Z")];
    summarizeCategories(input);
    expect(input[0].annotationTypes.map((t) => t.rank)).toEqual([2, 1, 3]);
  });
});

describe("resolveExpertCode", () => {
  const classes = [
    { id: "class-173", projectId: "project-a", code: "1.7.3", status: "ACTIVE" },
    { id: "class-17", projectId: "project-a", code: "1.7", status: "ACTIVE" },
    { id: "class-old", projectId: "project-a", code: "9", status: "INACTIVE" },
    { id: "class-b", projectId: "project-b", code: "2.1", status: "ACTIVE" },
  ];
  const db = {
    classType: {
      findFirst: async ({ where }: any) =>
        classes.find(
          (c) =>
            c.projectId === where.projectId && c.code === where.code && c.status === where.status
        ) ?? null,
    },
  } as unknown as Pick<PrismaTx, "classType">;

  it("finds an active class of the project by its code", async () => {
    expect(await resolveExpertCode(db, "project-a", "1.7.3")).toEqual({
      status: "FOUND",
      code: "1.7.3",
      classTypeId: "class-173",
    });
  });

  it("accepts a parent class as well as a leaf", async () => {
    expect(await resolveExpertCode(db, "project-a", "1.7")).toMatchObject({
      status: "FOUND",
      classTypeId: "class-17",
    });
  });

  it("ignores spaces around the code", async () => {
    expect(await resolveExpertCode(db, "project-a", " 1.7.3 ")).toMatchObject({ status: "FOUND" });
  });

  it("reports a code that is not a class of the project", async () => {
    expect(await resolveExpertCode(db, "project-a", "9.9")).toEqual({
      status: "UNKNOWN",
      code: "9.9",
    });
  });

  it("does not use a class of another project", async () => {
    expect(await resolveExpertCode(db, "project-a", "2.1")).toEqual({
      status: "UNKNOWN",
      code: "2.1",
    });
  });

  it("does not use a class that is not active", async () => {
    expect(await resolveExpertCode(db, "project-a", "9")).toEqual({ status: "UNKNOWN", code: "9" });
  });

  it("treats a missing or blank code as absent", async () => {
    expect(await resolveExpertCode(db, "project-a", null)).toEqual({ status: "ABSENT" });
    expect(await resolveExpertCode(db, "project-a", undefined)).toEqual({ status: "ABSENT" });
    expect(await resolveExpertCode(db, "project-a", "   ")).toEqual({ status: "ABSENT" });
  });
});