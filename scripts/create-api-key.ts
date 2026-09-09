import { randomBytes, createHash } from "crypto"; 
import prisma from "../src/lib/prisma";

async function main() {
  const projectId = process.argv[2];
  if (!projectId) {
    console.error("Usage: npx tsx scripts/create-api-key.ts <projectId> [name]");
    process.exit(1);
  }
  const name = process.argv[3] ?? "unnamed-key";

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    console.error(`No project found with id ${projectId}`);
    process.exit(1);
  }

  const plaintextKey = randomBytes(32).toString("hex");
  const hashedKey = createHash("sha256").update(plaintextKey).digest("hex");

  const apiKey = await prisma.apiKey.create({
    data: { name, hashedKey, projectId },
  });

  console.log(`API key created for project "${project.name}" (${project.id})`);
  console.log(`Key id: ${apiKey.id}`);
  console.log(`Plaintext key (shown once — store it now):\n\n  ${plaintextKey}\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());