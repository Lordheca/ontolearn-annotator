import { describe, it, expect } from "vitest";
import {
  parseClassesCsv,
  planImport,
  summarizePlan,
  ClassImportError,
  ClassImportConflictError,
  MAX_CLASSES,
  type ClassRow,
  type ExistingClass,
  type ImportPlan,
} from "../class-types-import";

const HEADER = "code;name_en;name_ja";

const SAMPLE = [
  HEADER,
  "1.2;Hexagon;六角形",
  "1.7;Singular Irregular;単数の不定形",
  "1.7.3;Deficient Hexagonal;六角形欠け",
  "3;No crystal;結晶無し",
].join("\n");

function existingClass(overrides: Partial<ExistingClass> & { id: string; name: string }): ExistingClass {
  return { code: null, position: null, relatedId: null, ...overrides };
}

// What the route does with a plan, in memory: used to check that a second import changes nothing.
function applyPlan(plan: ImportPlan, existing: ExistingClass[]): ExistingClass[] {
  const result = existing.map((row) => ({ ...row }));
  const idByCode = new Map<string, string>();

  for (const action of plan.actions) {
    const { code, name, position } = action.row;
    if (action.kind === "create") {
      const id = `new-${code}`;
      result.push({ id, name, code, position, relatedId: null });
      idByCode.set(code, id);
    } else {
      const row = result.find((candidate) => candidate.id === action.id)!;
      Object.assign(row, { name, code, position });
      idByCode.set(code, action.id);
    }
  }
  for (const action of plan.actions) {
    const row = result.find((candidate) => candidate.id === idByCode.get(action.row.code))!;
    row.relatedId = action.row.parentCode === null ? null : idByCode.get(action.row.parentCode)!;
  }
  return result;
}

describe("parseClassesCsv", () => {
  it("parses a valid file in order, with positions starting at 0", () => {
    const rows = parseClassesCsv(SAMPLE);
    expect(rows.map((row) => row.code)).toEqual(["1.2", "1.7", "1.7.3", "3"]);
    expect(rows.map((row) => row.position)).toEqual([0, 1, 2, 3]);
    expect(rows[0]).toEqual({ code: "1.2", name: "Hexagon", parentCode: null, position: 0 });
  });

  it("derives the parent from the longest prefix present in the file", () => {
    const rows = parseClassesCsv(SAMPLE);
    const parentOf = (code: string) => rows.find((row) => row.code === code)!.parentCode;
    expect(parentOf("1.7.3")).toBe("1.7");
    expect(parentOf("1.7")).toBeNull(); // "1" is a group header, not in the file
    expect(parentOf("3")).toBeNull();
  });

  it("accepts a BOM, Windows line endings, blank lines and a file without name_ja", () => {
    const rows = parseClassesCsv("\uFEFFcode;name_en\r\n1.1;Microparticle\r\n\r\n3; No crystal \r\n");
    expect(rows).toEqual([
      { code: "1.1", name: "Microparticle", parentCode: null, position: 0 },
      { code: "3", name: "No crystal", parentCode: null, position: 1 },
    ]);
  });

  it.each([
    ["a wrong header", "name;label\n1.1;Microparticle", "This does not look like a class list file (expected columns: code, name_en)."],
    ["a comma-separated file", "code,name_en\n1.1,Microparticle", "This does not look like a class list file (expected columns: code, name_en)."],
    ["no data rows", `${HEADER}\n\n`, "The file has no classes."],
    ["an empty code", `${HEADER}\n;Hexagon`, "Row 2: invalid code ''."],
    ["a malformed code", `${HEADER}\n1.1;Microparticle\n1..2;Hexagon`, "Row 3: invalid code '1..2'."],
    ["an empty name", `${HEADER}\n1.1;`, "Row 2: invalid name."],
    ["a name that is too long", `${HEADER}\n1.1;${"x".repeat(101)}`, "Row 2: invalid name."],
    ["a repeated code", `${HEADER}\n1.1;Microparticle\n1.1;Hexagon`, "Code '1.1' appears more than once."],
    ["a repeated name", `${HEADER}\n1.1;Hexagon\n1.2;Hexagon`, "Name 'Hexagon' appears more than once."],
  ])("rejects %s", (_case, text, message) => {
    expect(() => parseClassesCsv(text)).toThrow(ClassImportError);
    expect(() => parseClassesCsv(text)).toThrow(message);
  });

  it("rejects more than the maximum number of classes", () => {
    const lines = Array.from({ length: MAX_CLASSES + 1 }, (_, index) => `${index + 1};Class ${index + 1}`);
    expect(() => parseClassesCsv([HEADER, ...lines].join("\n"))).toThrow(
      "The file has too many classes (maximum 500)."
    );
  });
});

describe("planImport", () => {
  const rows: ClassRow[] = parseClassesCsv(SAMPLE);

  it("creates every class in an empty project", () => {
    const plan = planImport(rows, []);
    expect(plan.actions.map((action) => action.kind)).toEqual(["create", "create", "create", "create"]);
    expect(plan.notInFile).toEqual([]);
  });

  it("adopts a class with the same name and no code, keeping its id", () => {
    const plan = planImport(rows, [existingClass({ id: "a", name: "Singular Irregular" })]);
    expect(plan.actions[1]).toEqual({ kind: "adopt", id: "a", row: rows[1] });
    expect(summarizePlan(plan).adopted).toEqual([{ code: "1.7", name: "Singular Irregular" }]);
  });

  it("updates a class matched by code when its name, position or parent differ", () => {
    const plan = planImport(rows, [
      existingClass({ id: "p", name: "Singular Irregular", code: "1.7", position: 1 }),
      existingClass({ id: "c", name: "Deficient Hex", code: "1.7.3", position: 9 }),
    ]);
    expect(plan.actions[1]).toMatchObject({ kind: "unchanged", id: "p" });
    expect(plan.actions[2]).toMatchObject({ kind: "update", id: "c", changes: ["name", "position", "parent"] });
  });

  it("marks the parent as changed when the parent is created by the same import", () => {
    const plan = planImport(rows, [
      existingClass({ id: "c", name: "Deficient Hexagonal", code: "1.7.3", position: 2 }),
    ]);
    expect(plan.actions[2]).toMatchObject({ kind: "update", id: "c", changes: ["parent"] });
  });

  it("lists classes that are not in the file and plans nothing for them", () => {
    const plan = planImport(rows, [
      existingClass({ id: "x", name: "Test class" }),
      existingClass({ id: "y", name: "Old class", code: "9.9", position: 40 }),
    ]);
    expect(plan.notInFile).toEqual([
      { id: "x", name: "Test class", code: null },
      { id: "y", name: "Old class", code: "9.9" },
    ]);
    expect(plan.actions.every((action) => action.kind === "create")).toBe(true);
  });

  it("rejects a name that belongs to a class with a different code", () => {
    const existing = [existingClass({ id: "a", name: "Hexagon", code: "5.5", position: 0 })];
    expect(() => planImport(rows, existing)).toThrow(ClassImportConflictError);
    expect(() => planImport(rows, existing)).toThrow("'Hexagon' already exists with code '5.5'.");
  });

  it("rejects a rename that would duplicate the name of a class without a code", () => {
    const existing = [
      existingClass({ id: "a", name: "Six sides", code: "1.2", position: 0 }),
      existingClass({ id: "b", name: "Hexagon" }),
    ];
    expect(() => planImport(rows, existing)).toThrow("'Hexagon' already exists as a class without a code.");
  });

  it("is idempotent: importing the same file again changes nothing", () => {
    const before = [
      existingClass({ id: "a", name: "Singular Irregular" }),
      existingClass({ id: "x", name: "Test class" }),
    ];
    const after = applyPlan(planImport(rows, before), before);

    const summary = summarizePlan(planImport(rows, after));
    expect(summary).toMatchObject({ created: [], adopted: [], updated: [], unchanged: 4 });
    expect(summary.notInFile).toEqual([{ id: "x", name: "Test class", code: null }]);
  });
});

describe("summarizePlan", () => {
  it("counts each kind of action", () => {
    const rows = parseClassesCsv(SAMPLE);
    const summary = summarizePlan(
      planImport(rows, [
        existingClass({ id: "a", name: "Hexagon" }),
        existingClass({ id: "b", name: "No crystal", code: "3", position: 3 }),
        existingClass({ id: "c", name: "Singular", code: "1.7", position: 1 }),
      ])
    );
    expect(summary.created).toEqual([{ code: "1.7.3", name: "Deficient Hexagonal" }]);
    expect(summary.adopted).toEqual([{ code: "1.2", name: "Hexagon" }]);
    expect(summary.updated).toEqual([{ code: "1.7", name: "Singular Irregular", changes: ["name"] }]);
    expect(summary.unchanged).toBe(1);
  });
});