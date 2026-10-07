// Runs the content scripts the way the browser does: plain scripts sharing
// one global, each run once, here.

import { readFileSync } from "fs";

function source(name) {
  return readFileSync(new URL("../src/" + name, import.meta.url), "utf8");
}

globalThis.CKB = globalThis.CKB || {};
for (const name of ["net.js", "money.js", "csv.js"]) {
  new Function("globalThis", source(name))(globalThis);
}

export const CKB = globalThis.CKB;
