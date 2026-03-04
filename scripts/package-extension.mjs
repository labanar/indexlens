import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createWriteStream } from "node:fs";
import archiver from "archiver";
import { resolveExtensionVersion } from "./extension-version.mjs";

const rootDir = process.cwd();
const distDir = path.resolve(rootDir, "dist");
const artifactsDir = path.resolve(rootDir, "artifacts");

async function main() {
  const stats = await fs.stat(distDir).catch(() => null);
  if (!stats?.isDirectory()) {
    throw new Error(`Missing dist directory at ${distDir}. Run npm run build:extension first.`);
  }

  const manifestPath = path.join(distDir, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  if (manifest.manifest_version !== 3) {
    throw new Error(`dist/manifest.json must have manifest_version=3. Found: ${manifest.manifest_version}`);
  }

  const buildNumber = parseInt(process.env.BUILD_NUMBER || "0", 10);
  const version = await resolveExtensionVersion(rootDir, { buildNumber });
  if (manifest.version !== version) {
    throw new Error(
      `dist/manifest.json version (${manifest.version}) does not match resolved extension version (${version}). Re-run npm run build:extension.`,
    );
  }

  const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8"));
  const extensionName = String(packageJson.name || "extension")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "extension";

  await fs.mkdir(artifactsDir, { recursive: true });
  const outputFileName = `${extensionName}-v${version}.zip`;
  const outputPath = path.join(artifactsDir, outputFileName);

  const output = createWriteStream(outputPath);
  const archive = archiver("zip", { zlib: { level: 9 } });

  const done = new Promise((resolve, reject) => {
    output.on("close", resolve);
    archive.on("error", reject);
  });

  archive.pipe(output);
  archive.directory(distDir, false);
  await archive.finalize();
  await done;

  console.log(`Created ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
