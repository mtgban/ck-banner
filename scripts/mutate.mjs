// Breaks each guard in tests/mutations.json in turn and checks the suite
// notices: every mutation must fail the test it names.
//
// It works on a copy in a temporary directory, so the working tree is never
// touched. The copy holds what git would track (ignored files, saved pages
// among them, stay put), with node_modules linked in. The whole suite runs
// once, unmutated; each mutation then runs only the test it names, in the
// files that hold it, since no other test can report it.

import { spawnSync } from "child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = fileURLToPath(new URL("../", import.meta.url));
const mutations = JSON.parse(readFileSync(join(root, "tests/mutations.json"), "utf8"));
const bun = process.versions.bun ? process.execPath : "bun";
const testFiles = readdirSync(join(root, "tests"))
  .filter((name) => name.endsWith(".test.js"))
  .map((name) => "tests/" + name);

// holding is the test files whose source names a test.
function holding(name) {
  return testFiles.filter((file) => readFileSync(join(root, file), "utf8").includes(name));
}

function pattern(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tracked() {
  const listed = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
  });
  if (listed.status !== 0) {
    throw new Error("git ls-files failed: " + listed.stderr);
  }
  return listed.stdout.split("\0").filter((name) => name && existsSync(join(root, name)));
}

// LIMIT bounds one run of the suite, which takes seconds; a mutation that
// makes it hang must fail the runner rather than stall it.
const LIMIT = 120000;

// run answers with a test run's exit status and the names of its failed
// tests; args picks what runs, the whole suite by default.
function run(dir, args = ["tests/"]) {
  const result = spawnSync(bun, ["test", ...args], {
    cwd: dir,
    encoding: "utf8",
    timeout: LIMIT,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  if (result.error && result.error.code === "ETIMEDOUT") {
    return { status: null, failed: [], output: "", timedOut: true };
  }
  const output = (result.stdout + result.stderr).replace(/\x1b\[[0-9;]*m/g, "");
  const failed = output.split("\n").filter((line) => line.startsWith("(fail)"));
  return { status: result.status, failed, output };
}

const copy = mkdtempSync(join(tmpdir(), "ck-banner-mutate-"));
let missed = 0;
try {
  for (const name of tracked()) {
    mkdirSync(dirname(join(copy, name)), { recursive: true });
    cpSync(join(root, name), join(copy, name));
  }
  symlinkSync(join(root, "node_modules"), join(copy, "node_modules"));

  const clean = run(copy);
  if (clean.timedOut || clean.status !== 0) {
    console.error(clean.output);
    throw new Error("the suite fails before anything is mutated");
  }

  for (const m of mutations) {
    const files = holding(m.expectFailing);
    if (!files.length) {
      console.log(`UNKNOWN  ${m.guard}: no test file names "${m.expectFailing}"`);
      missed++;
      continue;
    }
    const file = join(copy, m.file);
    const original = readFileSync(file, "utf8");
    const found = original.split(m.find).length - 1;
    if (found !== 1) {
      // A list that no longer matches the code must not pass quietly.
      console.log(`STALE    ${m.guard}: found ${found} times in ${m.file}`);
      missed++;
      continue;
    }
    writeFileSync(file, original.replace(m.find, () => m.replace));
    const result = run(copy, [...files, "-t", pattern(m.expectFailing)]);
    writeFileSync(file, original);

    if (result.status !== 0 && result.failed.some((line) => line.includes(m.expectFailing))) {
      console.log(`caught   ${m.guard}`);
      continue;
    }
    missed++;
    if (result.timedOut) {
      console.log(`TIMED OUT ${m.guard}: the test did not finish in ${LIMIT / 1000} s`);
      continue;
    }
    if (result.status !== 0 && result.failed.length === 0) {
      console.log(`BROKEN   ${m.guard}: the test did not run; is the replacement valid code?`);
      continue;
    }
    console.log(`SURVIVED ${m.guard}: no failing test named "${m.expectFailing}"`);
    for (const line of result.failed) {
      console.log("         " + line);
    }
  }
} finally {
  rmSync(copy, { recursive: true, force: true });
}

console.log(`${mutations.length - missed} of ${mutations.length} mutations caught`);
process.exitCode = missed ? 1 : 0;
