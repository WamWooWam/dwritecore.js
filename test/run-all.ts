// Runs every compiled test in dist/test as its own child process (each test loads its own wasm
// instance, so isolation matters - a poisoned instance can't leak into the next test), aggregates
// pass/fail by exit code, and exits non-zero if any failed. Image tests regress against committed
// snapshots via ./harness, so a visual change shows up here as a failed child.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename } from "node:path";

const SELF = basename(fileURLToPath(import.meta.url));      // run-all.js
const EXCLUDE = new Set([SELF, "harness.js", "bench-renderers.js", "bench-leakprobe.js", "bench-prof.js", "bench-fillloop.js"]); // not tests themselves

const tests = readdirSync("dist/test")
  .filter((f) => f.endsWith(".js") && !EXCLUDE.has(f))
  .sort();

// Pull a concise status line out of a test's stdout for the summary.
function summarize(stdout: string): string {
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const result = [...lines].reverse().find((l) => /^RESULT:/.test(l));
  if (result) return result.replace(/^RESULT:\s*/, "");
  return lines.at(-1) ?? "";
}

let failed = 0;
const start = Date.now();
console.log(`Running ${tests.length} test files…\n`);

for (const t of tests) {
  const name = t.replace(/\.js$/, "");
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [`dist/test/${t}`], { encoding: "utf8" });
  const ms = Date.now() - t0;
  const ok = r.status === 0;
  if (!ok) failed++;
  const tag = ok ? "PASS" : "FAIL";
  console.log(`${tag}  ${name.padEnd(24)} ${`${ms}ms`.padStart(7)}  ${summarize(r.stdout ?? "")}`);
  if (!ok) {
    const errTail = (r.stderr ?? "").split(/\r?\n/).filter(Boolean).slice(-6);
    for (const line of errTail) console.log(`        ${line}`);
  }
}

const secs = ((Date.now() - start) / 1000).toFixed(1);
console.log(`\nRESULT: ${failed === 0 ? "SUCCESS" : "FAILURE"} - ${tests.length - failed}/${tests.length} test files passed in ${secs}s`);
process.exit(failed === 0 ? 0 : 1);
