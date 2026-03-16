import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const srcDir = path.resolve(projectRoot, "dist");
const targetDir = path.resolve(projectRoot, "..", "app", "static", "admin");
const tempDir = `${targetDir}.tmp`;
const legacyAssetAliases = [
  { current: path.join("assets", "admin-app.js"), aliases: ["assets/index-IdHuJco5.js", "assets/index-CKnDflIA.js"] },
  { current: path.join("assets", "admin-app.css"), aliases: ["assets/index-CZuzyXdJ.css", "assets/index-_81qfeqQ.css"] },
];

function removeIfExists(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return;
  }
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function copyTree(srcPath, destPath) {
  const stat = fs.statSync(srcPath);
  if (stat.isDirectory()) {
    fs.mkdirSync(destPath, { recursive: true });
    const entries = fs.readdirSync(srcPath, { withFileTypes: true });
    for (const entry of entries) {
      copyTree(path.join(srcPath, entry.name), path.join(destPath, entry.name));
    }
    return;
  }
  if (stat.isFile()) {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
  }
}

function ensureLegacyAliases(baseDir) {
  for (const group of legacyAssetAliases) {
    const currentPath = path.join(baseDir, group.current);
    if (!fs.existsSync(currentPath)) {
      continue;
    }

    for (const alias of group.aliases) {
      const aliasPath = path.join(baseDir, alias);
      if (path.resolve(aliasPath) === path.resolve(currentPath)) {
        continue;
      }
      fs.mkdirSync(path.dirname(aliasPath), { recursive: true });
      fs.copyFileSync(currentPath, aliasPath);
    }
  }
}

function fail(message, error) {
  console.error(message);
  if (error) {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
}

if (!fs.existsSync(srcDir)) {
  fail(`Build output not found: ${srcDir}`);
} else {
  try {
    removeIfExists(tempDir);
    fs.mkdirSync(tempDir, { recursive: true });
    copyTree(srcDir, tempDir);

    removeIfExists(targetDir);
    try {
      fs.renameSync(tempDir, targetDir);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code !== "EPERM") {
        throw error;
      }
      fs.mkdirSync(targetDir, { recursive: true });
      copyTree(tempDir, targetDir);
    }
    ensureLegacyAliases(targetDir);
    console.log(`Copied ${srcDir} -> ${targetDir}`);
  } catch (error) {
    fail("Failed to copy admin dist directory.", error);
  } finally {
    try {
      removeIfExists(tempDir);
    } catch {
      // best effort cleanup; do not mask main error
    }
  }
}
