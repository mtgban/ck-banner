// Breaks each guard in tests/mutations.json in turn and checks the suite
// notices: every mutation must fail the test it names.
//
// It works on a copy in a temporary directory, so the working tree is never
// touched. The copy holds what git would track (ignored files, saved pages
// among them, stay put), with node_modules linked in.

import { spawnSync } from "child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = fileURLToPath(new URL("../", import.meta.url));
const mutations = JSON.parse(readFileSync(join(root, "tests/mutations.json"), "utf8"));
const bun = process.versions.bun ? process.execPath : "bun";

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

// run answers with the suite's exit status and the names of its failed tests.
function run(dir) {
  const result = spawnSync(bun, ["test", "tests/"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
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
  if (clean.status !== 0) {
    console.error(clean.output);
    throw new Error("the suite fails before anything is mutated");
  }

  for (const m of mutations) {
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
    const result = run(copy);
    writeFileSync(file, original);

    if (result.status !== 0 && result.failed.some((line) => line.includes(m.expectFailing))) {
      console.log(`caught   ${m.guard}`);
      continue;
    }
    missed++;
    if (result.status !== 0 && result.failed.length === 0) {
      console.log(`BROKEN   ${m.guard}: the suite did not run; is the replacement valid code?`);
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
