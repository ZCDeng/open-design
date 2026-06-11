import assert from "node:assert/strict";
import { test } from "node:test";

import { collectBareRequireCalls } from "./check-no-cjs-require.ts";

test("flags a bare require() call in an ESM source", () => {
  const violations = collectBareRequireCalls("apps/x/src/a.ts", "const fs = require('node:fs');\n");
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.line, 1);
  assert.match(violations[0]?.text ?? "", /require\('node:fs'\)/);
});

test("flags the defensively-wrapped require pattern that fails silently", () => {
  const source = [
    "function safeRead(p) {",
    "  try {",
    "    const fs = (require ? require('node:fs') : null);",
    "    return fs.readFileSync(p, 'utf8');",
    "  } catch {",
    "    return null;",
    "  }",
    "}",
  ].join("\n");
  const violations = collectBareRequireCalls("apps/x/src/a.ts", source);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.line, 3);
});

test("allows require bound via node:module createRequire", () => {
  const source = [
    "import { createRequire } from 'node:module';",
    "const require = createRequire(import.meta.url);",
    "const pkg = require('./package.json');",
  ].join("\n");
  assert.deepEqual(collectBareRequireCalls("apps/x/src/a.ts", source), []);
});

test("known limitation: a require binding anywhere exempts the whole file", () => {
  // The function-scoped createRequire binding does not shadow the module-level
  // call, yet the file-scoped exemption skips it. Documented trade-off in the
  // collectBareRequireCalls docblock; the ESM runtime is the backstop.
  const source = [
    "import { createRequire } from 'node:module';",
    "function legacy() {",
    "  const require = createRequire(import.meta.url);",
    "  return require('./package.json');",
    "}",
    "const fs = require('node:fs');",
  ].join("\n");
  assert.deepEqual(collectBareRequireCalls("apps/x/src/a.ts", source), []);
});

test("allows a parameter named require", () => {
  const source = "export function load(require: (id: string) => unknown) { return require('x'); }\n";
  assert.deepEqual(collectBareRequireCalls("apps/x/src/a.ts", source), []);
});

test("ignores require inside strings and comments", () => {
  const source = [
    "// calling require('node:fs') here used to crash",
    "const msg = \"require('node:fs') is not allowed\";",
    "const re = /require\\(/;",
  ].join("\n");
  assert.deepEqual(collectBareRequireCalls("apps/x/src/a.ts", source), []);
});

test("ignores files without the require token entirely", () => {
  assert.deepEqual(collectBareRequireCalls("apps/x/src/a.ts", "export const a = 1;\n"), []);
});
