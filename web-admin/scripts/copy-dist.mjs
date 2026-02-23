import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const srcDir = path.resolve(projectRoot, "dist");
const targetDir = path.resolve(projectRoot, "..", "app", "static", "admin");
const tempDir = `${targetDir}.tmp`;

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
    fs.renameSync(tempDir, targetDir);
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
