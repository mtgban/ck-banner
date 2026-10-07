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

// pageOf builds page n of a list of total orders out of a history fixture:
// the fixture's rows, trimmed to what page n holds, with their ids moved
// along and their dates moved n - 1 years back so the list stays newest
// first, under a results line and final page link for that list.
export function pageOf(name, options) {
  return docOf(pageHTML(name, options));
}

// pageHTML is pageOf as the markup a fetch would answer with.
export function pageHTML(name, { n = 1, total, per = 25 } = {}) {
  const first = (n - 1) * per + 1;
  const last = Math.min(n * per, total);
  const doc = docOf(
    text(name)
      .replace(/\b([12]0000\d\d)\b/g, (id) => String(Number(id) + (n - 1) * 100))
      .replace(/, 2026\b/g, ", " + (2026 - (n - 1)))
      .replace(/\d+ - \d+ of \d+ results/, `${first} - ${last} of ${total} results`)
  );
  doc.querySelector('a[aria-label="Display Final Results Page"]').textContent = ` ${Math.ceil(total / per)} `;
  const rows = [...doc.querySelectorAll("tr")].filter((tr) => tr.querySelector("td"));
  rows.slice(last - first + 1).forEach((tr) => tr.remove());
  return doc.body.innerHTML;
}

// site stands in for Card Kingdom serving a list of total orders, recording
// every page asked for. change[n], when given, rewrites page n or answers
// with an Error to fail its fetch.
export function site(name, total, change = {}) {
  const asked = [];
  return {
    asked,
    fetchPage(url) {
      asked.push(url);
      const n = Number(/[?&]page=(\d+)$/.exec(url)[1]);
      const page = change[n] ? change[n](pageOf(name, { n, total })) : pageOf(name, { n, total });
      return page instanceof Error ? Promise.reject(page) : Promise.resolve(page);
    },
  };
}
