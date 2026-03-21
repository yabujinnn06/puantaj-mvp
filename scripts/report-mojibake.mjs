import fs from 'node:fs'
import path from 'node:path'

const rootDir = process.cwd()

const ignoredDirs = new Set([
  '.git',
  '.venv',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.push-main-employee',
  'tests',
])

const ignoredPathParts = [
  `${path.sep}app${path.sep}static${path.sep}admin${path.sep}assets${path.sep}`,
]

const ignoredFiles = new Set([
  'puantaj_test_log.txt',
  'puantaj_test_output.json',
  path.join('scripts', 'report-mojibake.mjs'),
])

const textExtensions = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.css',
  '.scss',
  '.html',
  '.md',
  '.txt',
  '.yml',
  '.yaml',
  '.py',
  '.sh',
  '.ps1',
])

const suspiciousPatterns = [
  /â[\u0080-\u00BF]/u,
  /Ã./u,
  /Ä./u,
  /Å./u,
  /\uFFFD/u,
]

function shouldSkip(filePath) {
  if (ignoredPathParts.some((part) => filePath.includes(part))) {
    return true
  }

  const relative = path.relative(rootDir, filePath)
  if (ignoredFiles.has(relative)) {
    return true
  }
  const parts = relative.split(path.sep)
  return parts.some((part) => ignoredDirs.has(part))
}

function walk(dirPath, results) {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name)

    if (entry.isDirectory()) {
      if (!shouldSkip(fullPath)) {
        walk(fullPath, results)
      }
      continue
    }

    if (!textExtensions.has(path.extname(entry.name))) {
      continue
    }

    if (shouldSkip(fullPath)) {
      continue
    }

    results.push(fullPath)
  }
}

const files = []
walk(rootDir, files)

const findings = []

for (const filePath of files) {
  const content = fs.readFileSync(filePath, 'utf8')
  const lines = content.split(/\r?\n/)

  lines.forEach((line, index) => {
    if (suspiciousPatterns.some((pattern) => pattern.test(line))) {
      findings.push({
        filePath: path.relative(rootDir, filePath),
        line: index + 1,
        snippet: line.trim(),
      })
    }
  })
}

if (!findings.length) {
  console.log('Mojibake taramasi temiz: supheli UTF-8 bozulmasi bulunmadi.')
  process.exit(0)
}

console.error('Supheli mojibake desenleri bulundu:\n')
for (const finding of findings) {
  console.error(`${finding.filePath}:${finding.line} ${finding.snippet}`)
}

process.exit(1)
