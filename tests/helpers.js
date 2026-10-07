// Runs the content scripts the way the browser does: plain scripts sharing
// one global, each run once, here.

import { Window } from "happy-dom";
import { readFileSync } from "fs";

function source(name) {
  return readFileSync(new URL("../src/" + name, import.meta.url), "utf8");
}

globalThis.CKB = globalThis.CKB || {};
for (const name of ["net.js", "money.js", "csv.js", "history.js"]) {
  new Function("globalThis", source(name))(globalThis);
}

export const CKB = globalThis.CKB;

// text reads a fixture as it sits on disk.
export function text(name) {
  return readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8");
}

// docOf parses markup in a window with no URL, so nothing it names is fetched.
export function docOf(html) {
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document;
}

export function load(name) {
  return docOf(text(name));
}
