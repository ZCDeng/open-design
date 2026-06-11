import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");

// Project-owned TypeScript source scopes. Generated output, vendored code,
// and runtime data directories are excluded by the skip list below.
const scannedRootDirectories = ["apps", "packages", "tools", "e2e", "scripts"];

const skippedDirectoryNames = new Set([
  ".next",
  ".od",
  ".od-data",
  ".od-e2e",
  ".tmp",
  ".vite",
  "dist",
  "generated",
  "node_modules",
  "out",
  "playwright-report",
  "reports",
  "test-results",
  "vendor",
]);

const scannedExtensions = new Set([".ts", ".tsx", ".mts"]);

export type CjsRequireViolation = {
  filePath: string;
  line: number;
  text: string;
};

/**
 * True when the file introduces its own `require` binding — the
 * `createRequire(import.meta.url)` interop pattern or a parameter named
 * `require`. Calls through such a binding are legal in ESM; only the bare
 * CommonJS global is not.
 */
function declaresRequireBinding(sourceFile: ts.SourceFile): boolean {
  let declared = false;

  const visit = (node: ts.Node): void => {
    if (declared) return;
    if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node)) &&
      node.name !== undefined &&
      ts.isIdentifier(node.name) &&
      node.name.text === "require"
    ) {
      declared = true;
      return;
    }
    if (ts.isImportSpecifier(node) && node.name.text === "require") {
      declared = true;
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return declared;
}

/**
 * AST-level equivalent of an ESLint `no-restricted-syntax` rule for
 * `CallExpression[callee.name='require']`: flags calls to the bare CommonJS
 * `require` global inside ESM TypeScript sources, where it either crashes
 * (`ERR_AMBIGUOUS_MODULE_SYNTAX` / `require is not defined`) or — wrapped in
 * try/catch — fails silently. Files that bind `require` themselves via
 * `node:module` `createRequire` are exempt.
 *
 * The exemption is file-scoped, not binding-scoped: a `require` binding
 * anywhere in the file exempts every call in it, including a bare module-level
 * `require()` the binding does not actually shadow. Scope-accurate resolution
 * needs the type checker; the ESM runtime still rejects such a call, so this
 * check accepts the false negative.
 */
export function collectBareRequireCalls(repositoryPath: string, sourceText: string): CjsRequireViolation[] {
  // Cheap prefilter: parsing is only needed when the token appears at all.
  if (!sourceText.includes("require")) return [];

  const sourceFile = ts.createSourceFile(repositoryPath, sourceText, ts.ScriptTarget.Latest, true);
  if (declaresRequireBinding(sourceFile)) return [];

  const violations: CjsRequireViolation[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require") {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      violations.push({
        filePath: repositoryPath,
        line: line + 1,
        text: node.getText(sourceFile).split("\n")[0] ?? "",
      });
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
}

function toRepositoryPath(filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

async function collectScannedFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (skippedDirectoryNames.has(entry.name) || entry.name.startsWith(".")) continue;
      files.push(...(await collectScannedFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && scannedExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

export async function checkNoCjsRequire(): Promise<boolean> {
  const violations: CjsRequireViolation[] = [];

  for (const rootDirectory of scannedRootDirectories) {
    const files = await collectScannedFiles(path.join(repoRoot, rootDirectory));
    for (const filePath of files) {
      const sourceText = await readFile(filePath, "utf8");
      violations.push(...collectBareRequireCalls(toRepositoryPath(filePath), sourceText));
    }
  }

  if (violations.length > 0) {
    console.error("Bare CommonJS require() calls found in ESM TypeScript sources:");
    for (const violation of violations) {
      console.error(`- ${violation.filePath}:${violation.line} ${violation.text}`);
    }
    console.error(
      "Use a top-level import, or bind require explicitly via node:module createRequire(import.meta.url).",
    );
    return false;
  }

  console.log("CJS require check passed: no bare require() calls in ESM TypeScript sources.");
  return true;
}
