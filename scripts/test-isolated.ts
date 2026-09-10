import { spawn } from "node:child_process";
import { access, glob } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, sep } from "node:path";

const testPatterns = ["**/*.test.ts", "**/*.test.tsx"];

/** Known install locations for sandboxed environments where bun is not on PATH. */
const FALLBACK_BUN_PATHS = ["/vercel/share/pnpm/bun"];

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveBun(): Promise<string> {
  const explicit = process.env.BUN_BINARY;
  if (explicit) return explicit;

  const pathEntries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const candidates = [
    ...pathEntries.map((dir) => `${dir}${sep}bun`),
    ...FALLBACK_BUN_PATHS,
  ];

  for (const candidate of candidates) {
    if (await isExecutable(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "bun was not found. Install it, add it to PATH, or set BUN_BINARY (e.g. /vercel/share/pnpm/bun).",
  );
}

function isIgnoredPath(path: string): boolean {
  return path.startsWith("node_modules/") || path.startsWith(".");
}

async function collectTestFiles(): Promise<string[]> {
  const files = new Set<string>();

  for (const pattern of testPatterns) {
    for await (const path of glob(pattern)) {
      if (isIgnoredPath(path)) {
        continue;
      }
      files.add(path);
    }
  }

  return [...files].sort((a, b) => a.localeCompare(b));
}

async function runTestsIndividually(
  files: string[],
  bunPath: string,
): Promise<void> {
  for (const file of files) {
    console.log(`\nRunning ${file}`);

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const childProcess = spawn(bunPath, ["test", file], {
        stdio: "inherit",
      });

      childProcess.on("error", reject);
      childProcess.on("close", resolve);
    });

    if (exitCode !== 0) {
      throw new Error(`Test failed: ${file}`);
    }
  }
}

async function main() {
  const bunPath = await resolveBun();
  const files = await collectTestFiles();

  if (files.length === 0) {
    console.log("No test files found.");
    return;
  }

  console.log(`Running ${files.length} test files in isolated processes...`);
  await runTestsIndividually(files, bunPath);
  console.log("\nAll isolated tests passed.");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
