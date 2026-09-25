import { existsSync, readFileSync, unlinkSync } from "fs";
import path from "path";
import prisma from "../src/lib/prisma";
import { objectExists, putObject } from "../src/lib/storage";

// File Storage Remediation Plan, Phase 2 Step 9: batch backfill of whatever
// is still on local disk into the bucket, in one maintenance-window run
// (Confirmed 2026-09-10 -- not trickled gradually, since the dual-read
// fallback in src/app/api/files/[id]/route.ts and
// src/app/api/icons/[filename]/route.ts is a staging safety net, not meant
// to be relied on long-term).
//
// Covers every row shape the two read routes serve: DataFile.filePath,
// PlaygroundTask.input.file, SourceField.value (FILE-type fields only --
// route.ts's third branch, added in Phase 1 Step 4 for upload.py's zip
// downloads), and Project.icon. The plan's own Step 9/§Step 5 text names
// only "DataFile/PlaygroundTask rows" -- SourceField was folded in here
// too since it's served through the exact same dual-read branch in
// route.ts and would otherwise be silently missed.
//
// A row only needs backfilling if its bytes are still actually on local
// disk -- resolveDiskPath below mirrors route.ts's own rule (leading slash
// = old public/ value, no leading slash = storage/ value) since a
// no-leading-slash value could equally be a Step-8-onward row that was
// never on disk at all. Existence on disk, not the string shape, decides.
//
// Collision guard: DataFile/PlaygroundTask/SourceField keys embed a fresh
// uuidv4() per upload, so they can never collide with a live bucket key.
// Project icon keys are NOT unique this way -- icons/<projectId>.png is the
// same key every time that project's icon is re-uploaded. A project
// re-uploaded after Step 8 already has its current icon in the bucket at
// that exact key; a stale pre-Step-8 file can still be sitting on disk
// under the same filename. Blindly migrating it would silently overwrite
// the correct, newer bucket object with the old one. Every candidate is
// checked against the bucket with objectExists before upload -- a hit is
// reported separately as a stale local leftover, never overwritten.
//
// Safe by default: without --confirm, only prints what it *would* migrate
// and delete. Re-run with --confirm once the dry-run counts look right.
//
// Usage:
//   npx tsx scripts/backfill-storage.ts            (dry run)
//   npx tsx scripts/backfill-storage.ts --confirm  (actually migrates)

const confirm = process.argv.includes("--confirm");

function resolveDiskPath(storedPath: string): string {
  if (storedPath.startsWith("/")) {
    return path.join(process.cwd(), "public", storedPath);
  }
  return path.join(process.cwd(), "storage", storedPath);
}

function newKeyFor(storedPath: string): string {
  return storedPath.startsWith("/") ? storedPath.slice(1) : storedPath;
}

function guessContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
    ".zip": "application/zip",
    ".pdf": "application/pdf",
  };
  return map[ext] || "application/octet-stream";
}

type Candidate = {
  kind: "DataFile" | "PlaygroundTask" | "SourceField" | "Project icon";
  id: string;
  diskPath: string;
  newKey: string;
  updateFilePath: boolean;
  playgroundInput?: Record<string, unknown>;
};

async function findCandidates(): Promise<Candidate[]> {
  const candidates: Candidate[] = [];

  const dataFiles = await prisma.dataFile.findMany({ select: { id: true, filePath: true } });
  for (const df of dataFiles) {
    const diskPath = resolveDiskPath(df.filePath);
    if (existsSync(diskPath)) {
      candidates.push({
        kind: "DataFile",
        id: df.id,
        diskPath,
        newKey: newKeyFor(df.filePath),
        updateFilePath: df.filePath.startsWith("/"),
      });
    }
  }

  const playgroundTasks = await prisma.playgroundTask.findMany({ select: { id: true, input: true } });
  for (const pt of playgroundTasks) {
    const input = pt.input as Record<string, unknown> | null;
    const file = input?.file as string | undefined;
    if (!file) continue;
    const diskPath = resolveDiskPath(file);
    if (existsSync(diskPath)) {
      candidates.push({
        kind: "PlaygroundTask",
        id: pt.id,
        diskPath,
        newKey: newKeyFor(file),
        updateFilePath: file.startsWith("/"),
        playgroundInput: input ?? {},
      });
    }
  }

  const sourceFields = await prisma.sourceField.findMany({
    where: { field: { type: "FILE" } },
    select: { id: true, value: true },
  });
  for (const sf of sourceFields) {
    const diskPath = resolveDiskPath(sf.value);
    if (existsSync(diskPath)) {
      candidates.push({
        kind: "SourceField",
        id: sf.id,
        diskPath,
        newKey: newKeyFor(sf.value),
        updateFilePath: sf.value.startsWith("/"),
      });
    }
  }

  const projects = await prisma.project.findMany({
    where: { icon: { not: null } },
    select: { id: true, icon: true },
  });
  for (const p of projects) {
    if (!p.icon) continue;
    const diskPath = path.join(process.cwd(), "public", "img", "projects", p.icon);
    if (existsSync(diskPath)) {
      candidates.push({
        kind: "Project icon",
        id: p.id,
        diskPath,
        newKey: `icons/${p.icon}`,
        updateFilePath: false,
      });
    }
  }

  return candidates;
}

async function main() {
  const candidates = await findCandidates();

  const plan: Candidate[] = [];
  const collisions: Candidate[] = [];

  for (const c of candidates) {
    // uuidv4()-based keys (DataFile/PlaygroundTask/SourceField) are unique
    // by construction and never need this check, but it's cheap and
    // correct to run it uniformly rather than special-case by kind.
    if (await objectExists(c.newKey)) {
      collisions.push(c);
    } else {
      plan.push(c);
    }
  }

  console.log(`Found ${plan.length} file(s) to migrate:`);
  for (const item of plan) {
    console.log(
      `  [${item.kind}] ${item.id} -- ${item.diskPath} -> ${item.newKey}${item.updateFilePath ? " (DB value will be updated)" : ""}`
    );
  }

  if (collisions.length > 0) {
    console.log(`\n${collisions.length} SKIPPED -- bucket already has a newer object at this key (stale local leftover, NOT touched):`);
    for (const item of collisions) {
      console.log(`  [${item.kind}] ${item.id} -- ${item.diskPath} already superseded by ${item.newKey} in the bucket`);
    }
    console.log("  Safe to delete these local files by hand once you've confirmed the bucket version is the right one.");
  }

  if (plan.length === 0) {
    console.log("\nNothing left to migrate.");
    return;
  }

  if (!confirm) {
    console.log("\nDry run only -- nothing was uploaded, updated, or deleted.");
    console.log("Re-run with --confirm once these counts look right.");
    return;
  }

  // Group by diskPath so a single physical file referenced by more than one
  // DB row (e.g. a FILE-type SourceField and the DataFile created from the
  // same upload, both pointing at the same key) gets uploaded and deleted
  // exactly once, not once per row.
  const groups = new Map<string, Candidate[]>();
  for (const item of plan) {
    const group = groups.get(item.diskPath) ?? [];
    group.push(item);
    groups.set(item.diskPath, group);
  }

  let migratedRows = 0;
  let migratedFiles = 0;
  const failures: string[] = [];

  for (const [diskPath, items] of Array.from(groups)) {
    try {
      const newKey = items[0].newKey;
      const buffer = readFileSync(diskPath);
      await putObject(newKey, buffer, guessContentType(diskPath));

      for (const item of items) {
        if (item.updateFilePath) {
          if (item.kind === "DataFile") {
            await prisma.dataFile.update({ where: { id: item.id }, data: { filePath: item.newKey } });
          } else if (item.kind === "PlaygroundTask") {
            await prisma.playgroundTask.update({
              where: { id: item.id },
              data: { input: { ...(item.playgroundInput ?? {}), file: item.newKey } },
            });
          } else if (item.kind === "SourceField") {
            await prisma.sourceField.update({ where: { id: item.id }, data: { value: item.newKey } });
          }
        }
        migratedRows++;
        console.log(`  migrated [${item.kind}] ${item.id}`);
      }

      unlinkSync(diskPath);
      migratedFiles++;
    } catch (e) {
      for (const item of items) {
        failures.push(`[${item.kind}] ${item.id}: ${(e as Error).message}`);
      }
      console.error(`  FAILED for ${diskPath} (affects ${items.length} row(s)):`, e);
    }
  }

  console.log(`\nMigrated ${migratedFiles} physical file(s), covering ${migratedRows}/${plan.length} row(s).`);
  if (failures.length > 0) {
    console.log(`${failures.length} row failure(s) -- see above for which physical file(s) failed:`);
    failures.forEach((f) => console.log(`  ${f}`));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());