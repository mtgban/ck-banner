// Runs the parsers on real saved pages, when they are given:
//
//   CK_SAVED_ORDERS=<saved order history.html> \
//   CK_SAVED_SALES=<saved selling history.html> bun test tests/
//
// A saved page carries an account's data and never enters the repository, so
// without the variables these tests skip.

import { test, expect, describe } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { Window } from "happy-dom";
import { CKB, text } from "./helpers.js";

const SAVED = { purchases: process.env.CK_SAVED_ORDERS, sales: process.env.CK_SAVED_SALES };

// The statuses the history pages' legend names, and a sale's finished one.
const KNOWN = ["BALANCE DUE", "CANCELED", "PRESALE", "PROCESSING", "READY SOON", "SHIPPED", "COMPLETED"];

// savedPage strips everything a saved page could fetch, and parses the rest
// in a window with no URL.
function savedPage(path) {
  const html = readFileSync(path, "utf8")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<(link|img|iframe|source|video)\b[^>]*>/gi, "")
    .replace(/url\([^)]*\)/gi, "");
  const window = new Window({
    settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true },
  });
  return new window.DOMParser().parseFromString(html, "text/html");
}

for (const kind of ["purchases", "sales"]) {
  describe("the saved " + kind + " page", () => {
    test.skipIf(!SAVED[kind])("reads whole", () => {
      const rows = CKB.readHistory(savedPage(SAVED[kind]), kind);
      expect(rows.length).toBe(25);
      expect(rows.filter((row) => !KNOWN.includes(row.status))).toEqual([]);
      const exported = rows.filter((row) => CKB.exported(row, kind));
      expect(exported.length).toBeGreaterThan(0);
      expect(exported.filter((row) => CKB.yearOf(row, kind) === null)).toEqual([]);
    });

    test.skipIf(!SAVED[kind])("left none of its order ids in a fixture", () => {
      const ids = CKB.readHistory(savedPage(SAVED[kind]), kind).map((row) => row.orderID);
      const fixtures = readdirSync(new URL("./fixtures/", import.meta.url)).map(text).join("\n");
      expect(ids.filter((id) => fixtures.includes(id))).toEqual([]);
    });
  });
}
