import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import prisma from "../src/lib/prisma";
import { createExpertAnnotation, createMlAnnotation } from "../src/lib/annotations";

// New Workflow, ticket 1: sample expert and ML annotations for the dev project, so the
// screens that show them (suggestions panel, category columns) can be built before the
// real pipeline (annotated zip import, inference worker) exists.
//
// Takes up to 20 of the project's most recent images that have no expert annotation
// and no seed ML annotation yet, and gives them a fixed, repeatable mix:
//   - expert + ML that agree
//   - expert + ML that disagree
//   - ML only, expert only
//   - nothing (shown as "Pending")
// ML annotations use modelVersion "seed-v0" and three labels whose confidences sum to
// less than 1. Classes are picked from the project's ACTIVE ClassTypes, whether or not
// they have codes yet.
//
// What was created is recorded in scripts/.seed-new-workflow.<projectId>.json, which
// --undo reads to delete exactly those rows. Annotations made by people are never
// touched.
//
// Safe by default: without --confirm, only prints what it *would* do.
//
// Usage:
//   npx tsx scripts/seed-new-workflow.ts <projectId>                   (dry run)
//   npx tsx scripts/seed-new-workflow.ts <projectId> --confirm         (creates the data)
//   npx tsx scripts/seed-new-workflow.ts <projectId> --undo            (dry run of the removal)
//   npx tsx scripts/seed-new-workflow.ts <projectId> --undo --confirm  (removes the data)

const SEED_MODEL_VERSION = "seed-v0";
const MAX_IMAGES = 20;

type Kind = "agree" | "disagree" | "ml-only" | "expert-only" | "none";

// One entry per image, in order. Over 20 images: 7 agree, 6 disagree, 2 ML only,
// 2 expert only, 3 with nothing. The first five cover every kind, so a project with
// only a few images still shows each case.
const PATTERN: Kind[] = [
  "agree", "disagree", "ml-only", "expert-only", "none",
  "agree", "disagree", "none", "agree", "disagree",
  "none", "agree", "disagree", "ml-only", "expert-only",
  "agree", "disagree", "agree", "disagree", "agree",
];

// Top-3 confidences, cycled per image. Each row sums to less than 1.
const CONFIDENCES: [number, number, number][] = [
  [0.71, 0.14, 0.06],
  [0.48, 0.27, 0.11],
  [0.39, 0.33, 0.12],
  [0.92, 0.03, 0.01],
];

type ClassRef = { id: string; name: string };

type PlanItem = {
  dataFileId: string;
  name: string;
  kind: Kind;
  expert: ClassRef | null;
  ml: { classTypeId: string; name: string; confidence: number }[] | null;
};

type SeedState = {
  projectId: string;
  createdAt: string;
  expertAnnotationIds: string[];
  mlAnnotationIds: string[];
};

const args = process.argv.slice(2);
const confirm = args.includes("--confirm");
const undo = args.includes("--undo");
const projectId = args.find((arg) => !arg.startsWith("--"));

function stateFilePath(id: string): string {
  return path.join(process.cwd(), "scripts", `.seed-new-workflow.${id}.json`);
}

function buildPlan(dataFiles: { id: string; name: string }[], classes: ClassRef[]): PlanItem[] {
  const pick = (index: number) => classes[index % classes.length];

  return dataFiles.map((dataFile, i) => {
    const kind = PATTERN[i % PATTERN.length];
    const hasExpert = kind === "agree" || kind === "disagree" || kind === "expert-only";
    const hasMl = kind === "agree" || kind === "disagree" || kind === "ml-only";

    // The expert's class is pick(i). An agreeing model puts that class first; a
    // disagreeing one starts from the next class.
    const mlStart = kind === "disagree" ? i + 1 : i;
    const confidences = CONFIDENCES[i % CONFIDENCES.length];

    return {
      dataFileId: dataFile.id,
      name: dataFile.name,
      kind,
      expert: hasExpert ? pick(i) : null,
      ml: hasMl
        ? confidences.map((confidence, rank) => {
            const classType = pick(mlStart + rank);
            return { classTypeId: classType.id, name: classType.name, confidence };
          })
        : null,
    };
  });
}

async function seed(id: string) {
  const statePath = stateFilePath(id);
  if (existsSync(statePath)) {
    console.log(`This project is already seeded (${path.relative(process.cwd(), statePath)} exists).`);
    console.log("Run with --undo --confirm first if you want to seed it again.");
    return;
  }

  const classes = await prisma.classType.findMany({
    where: { projectId: id, status: "ACTIVE" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, name: true },
  });
  if (classes.length < 3) {
    console.log(`The project needs at least 3 active class types; it has ${classes.length}.`);
    return;
  }

  const dataFiles = await prisma.dataFile.findMany({
    where: {
      source: { projectId: id },
      type: { in: ["IMAGE", "DEEP_ZOOM_IMAGE"] },
      annotations: {
        none: { OR: [{ author: "EXPERT" }, { author: "ML", modelVersion: SEED_MODEL_VERSION }] },
      },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_IMAGES,
    select: { id: true, name: true, destination: true },
  });
  if (dataFiles.length === 0) {
    console.log("No images to seed in this project.");
    return;
  }

  const plan = buildPlan(dataFiles, classes);

  console.log(`${confirm ? "Seeding" : "Would seed"} ${plan.length} image(s):\n`);
  for (const item of plan) {
    const expert = item.expert ? item.expert.name : "-";
    const ml = item.ml
      ? item.ml.map((label) => `${label.name} ${Math.round(label.confidence * 100)}%`).join(", ")
      : "-";
    console.log(`  ${item.kind.padEnd(11)}  ${item.name}`);
    console.log(`               expert: ${expert}`);
    console.log(`               ml:     ${ml}`);
  }

  const count = (kind: Kind) => plan.filter((item) => item.kind === kind).length;
  console.log(
    `\nMix: ${count("agree")} agree, ${count("disagree")} disagree, ${count("ml-only")} ML only, ` +
      `${count("expert-only")} expert only, ${count("none")} with nothing.`
  );

  const notManual = dataFiles.filter((dataFile) => dataFile.destination !== "MANUAL").length;
  if (notManual > 0) {
    console.log(
      `Note: ${notManual} of these images are not destination = MANUAL, so the Annotations ` +
        "pages do not list them until the destination filter is removed."
    );
  }

  if (!confirm) {
    console.log("\nDry run: nothing was written. Re-run with --confirm to create the data.");
    return;
  }

  const state: SeedState = {
    projectId: id,
    createdAt: new Date().toISOString(),
    expertAnnotationIds: [],
    mlAnnotationIds: [],
  };

  await prisma.$transaction(
    async (tx) => {
      for (const item of plan) {
        if (item.expert) {
          const annotation = await createExpertAnnotation(tx, item.dataFileId, item.expert.id);
          state.expertAnnotationIds.push(annotation.id);
        }
        if (item.ml) {
          const annotation = await createMlAnnotation(
            tx,
            item.dataFileId,
            SEED_MODEL_VERSION,
            item.ml.map(({ classTypeId, confidence }) => ({ classTypeId, confidence }))
          );
          state.mlAnnotationIds.push(annotation.id);
        }
      }
    },
    { timeout: 60_000 }
  );

  writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");

  console.log(
    `\nCreated ${state.expertAnnotationIds.length} expert and ${state.mlAnnotationIds.length} ML annotation(s).`
  );
  console.log(`Recorded in ${path.relative(process.cwd(), statePath)} (needed by --undo; do not commit it).`);
}

async function undoSeed(id: string) {
  const statePath = stateFilePath(id);
  const state: SeedState | null = existsSync(statePath)
    ? JSON.parse(readFileSync(statePath, "utf-8"))
    : null;

  if (!state) {
    console.log(`No ${path.relative(process.cwd(), statePath)} found: the expert annotations this script`);
    console.log(`created cannot be identified. Only "${SEED_MODEL_VERSION}" ML annotations will be removed.\n`);
  }

  const annotations = await prisma.annotation.findMany({
    where: {
      dataFile: { source: { projectId: id } },
      OR: [
        { author: "ML", modelVersion: SEED_MODEL_VERSION },
        { author: "EXPERT", id: { in: state?.expertAnnotationIds ?? [] } },
      ],
    },
    select: { id: true, author: true },
  });

  const ids = annotations.map((annotation) => annotation.id);
  const expertCount = annotations.filter((annotation) => annotation.author === "EXPERT").length;
  const mlCount = annotations.length - expertCount;

  console.log(`${confirm ? "Removing" : "Would remove"} ${expertCount} expert and ${mlCount} ML annotation(s).`);

  if (!confirm) {
    console.log("Dry run: nothing was deleted. Re-run with --undo --confirm to remove them.");
    return;
  }

  await prisma.$transaction([
    prisma.annotationType.deleteMany({ where: { annotationId: { in: ids } } }),
    prisma.annotation.deleteMany({ where: { id: { in: ids } } }),
  ]);

  if (state) {
    unlinkSync(statePath);
  }
  console.log("Done.");
}

async function main() {
  if (!projectId) {
    console.log("Usage: npx tsx scripts/seed-new-workflow.ts <projectId> [--undo] [--confirm]");
    process.exitCode = 1;
    return;
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) {
    console.log(`Project ${projectId} not found.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Project: ${project.name} (${project.id})\n`);

  if (undo) {
    await undoSeed(project.id);
  } else {
    await seed(project.id);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());