// Import of a class list (classes.csv) into a project's ClassTypes.
//
// classes.csv is the list shared with the ML side: `code;name_en;name_ja`, one class
// per row, and the row order is the model's output order.
//
// This module is pure (no database): parseClassesCsv validates the file and
// planImport decides what to do with each row. The route applies the plan.
// Every ClassImportError message is shown to the user as it is.

export const MAX_CLASSES = 500;
export const MAX_NAME_LENGTH = 100;

const CODE_PATTERN = /^[A-Za-z0-9]+(\.[A-Za-z0-9]+)*$/;

/** The file is not a valid class list. Nothing must be written. */
export class ClassImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClassImportError";
  }
}

/** The file is valid but contradicts the classes the project already has. */
export class ClassImportConflictError extends ClassImportError {
  constructor(message: string) {
    super(message);
    this.name = "ClassImportConflictError";
  }
}

export type ClassRow = {
  code: string;
  name: string;
  parentCode: string | null;
  position: number;
};

export type ExistingClass = {
  id: string;
  name: string;
  code: string | null;
  position: number | null;
  relatedId: string | null;
};

export type ImportAction =
  | { kind: "create"; row: ClassRow }
  | { kind: "adopt"; id: string; row: ClassRow }
  | { kind: "update"; id: string; row: ClassRow; changes: string[] }
  | { kind: "unchanged"; id: string; row: ClassRow };

export type ImportPlan = {
  /** One action per row, in file order. */
  actions: ImportAction[];
  notInFile: { id: string; name: string; code: string | null }[];
};

export type ImportSummary = {
  created: { code: string; name: string }[];
  adopted: { code: string; name: string }[];
  updated: { code: string; name: string; changes: string[] }[];
  unchanged: number;
  notInFile: { id: string; name: string; code: string | null }[];
};

/** The parent of a code is its longest dot-prefix that is also in the file. */
function findParentCode(code: string, codes: Set<string>): string | null {
  const parts = code.split(".");
  for (let length = parts.length - 1; length >= 1; length--) {
    const prefix = parts.slice(0, length).join(".");
    if (codes.has(prefix)) return prefix;
  }
  return null;
}

/**
 * Parses the text of a classes.csv file.
 * Throws ClassImportError on the first problem found. Row numbers are line numbers
 * of the file (the header is row 1), which is what a spreadsheet shows.
 */
export function parseClassesCsv(text: string): ClassRow[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);

  const header = (lines[0] ?? "").split(";").map((column) => column.trim().toLowerCase());
  if (header[0] !== "code" || header[1] !== "name_en") {
    throw new ClassImportError(
      "This does not look like a class list file (expected columns: code, name_en)."
    );
  }

  const parsed: { code: string; name: string }[] = [];
  const codes = new Set<string>();
  const names = new Set<string>();

  for (let index = 1; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (line.trim() === "") continue;

    const rowNumber = index + 1;
    const [rawCode = "", rawName = ""] = line.split(";");
    const code = rawCode.trim();
    const name = rawName.trim();

    if (!CODE_PATTERN.test(code)) {
      throw new ClassImportError(`Row ${rowNumber}: invalid code '${code}'.`);
    }
    if (name === "" || name.length > MAX_NAME_LENGTH) {
      throw new ClassImportError(`Row ${rowNumber}: invalid name.`);
    }
    if (codes.has(code)) {
      throw new ClassImportError(`Code '${code}' appears more than once.`);
    }
    if (names.has(name)) {
      throw new ClassImportError(`Name '${name}' appears more than once.`);
    }

    codes.add(code);
    names.add(name);
    parsed.push({ code, name });

    if (parsed.length > MAX_CLASSES) {
      throw new ClassImportError(`The file has too many classes (maximum ${MAX_CLASSES}).`);
    }
  }

  if (parsed.length === 0) {
    throw new ClassImportError("The file has no classes.");
  }

  return parsed.map((row, position) => ({
    ...row,
    parentCode: findParentCode(row.code, codes),
    position,
  }));
}

/**
 * Decides what to do with each row, given the project's current classes:
 *   1. a class with this code exists           -> update it if name, position or parent differ
 *   2. a class with this name and no code exists -> adopt it (same id, annotations untouched)
 *   3. otherwise                                -> create it
 * Classes of the project that are not in the file are never touched; they are only listed.
 * Throws ClassImportConflictError when a name of the file is already taken by another class.
 */
export function planImport(rows: ClassRow[], existing: ExistingClass[]): ImportPlan {
  const byCode = new Map<string, ExistingClass>();
  for (const existingClass of existing) {
    if (existingClass.code !== null) byCode.set(existingClass.code, existingClass);
  }

  // Pass 1: match every row to an existing class, or to none.
  const matches = rows.map((row) => {
    const sameCode = byCode.get(row.code) ?? null;
    const sameName = existing.filter(
      (existingClass) => existingClass.name === row.name && existingClass.id !== sameCode?.id
    );

    const withOtherCode = sameName.find((existingClass) => existingClass.code !== null);
    if (withOtherCode) {
      throw new ClassImportConflictError(
        `'${row.name}' already exists with code '${withOtherCode.code}'.`
      );
    }
    if (sameCode && sameName.length > 0) {
      // Renaming the coded class would produce two classes with the same name.
      throw new ClassImportConflictError(`'${row.name}' already exists as a class without a code.`);
    }

    if (sameCode) return { row, match: sameCode, adopted: false };
    if (sameName[0]) return { row, match: sameName[0], adopted: true };
    return { row, match: null, adopted: false };
  });

  // Pass 2: the id each code will have after the import (null = created by this import).
  const idByCode = new Map<string, string | null>();
  for (const { row, match } of matches) {
    idByCode.set(row.code, match?.id ?? null);
  }

  const actions: ImportAction[] = matches.map(({ row, match, adopted }) => {
    if (!match) return { kind: "create", row };
    if (adopted) return { kind: "adopt", id: match.id, row };

    const changes: string[] = [];
    if (match.name !== row.name) changes.push("name");
    if (match.position !== row.position) changes.push("position");

    const parentId = row.parentCode === null ? null : idByCode.get(row.parentCode) ?? null;
    const parentIsNew = row.parentCode !== null && parentId === null;
    if (parentIsNew || match.relatedId !== parentId) changes.push("parent");

    return changes.length > 0
      ? { kind: "update", id: match.id, row, changes }
      : { kind: "unchanged", id: match.id, row };
  });

  const matchedIds = new Set(matches.map(({ match }) => match?.id).filter(Boolean));
  const notInFile = existing
    .filter((existingClass) => !matchedIds.has(existingClass.id))
    .map(({ id, name, code }) => ({ id, name, code }));

  return { actions, notInFile };
}

/** The result shown to the user, the same for a dry run and for the real import. */
export function summarizePlan(plan: ImportPlan): ImportSummary {
  const summary: ImportSummary = {
    created: [],
    adopted: [],
    updated: [],
    unchanged: 0,
    notInFile: plan.notInFile,
  };

  for (const action of plan.actions) {
    const { code, name } = action.row;
    if (action.kind === "create") summary.created.push({ code, name });
    else if (action.kind === "adopt") summary.adopted.push({ code, name });
    else if (action.kind === "update") summary.updated.push({ code, name, changes: action.changes });
    else summary.unchanged += 1;
  }

  return summary;
}