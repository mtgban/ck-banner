// Runs the parsers on real saved pages, when they are given:
//
//   CK_SAVED_ORDERS=<saved order history.html> \
//   CK_SAVED_SALES=<saved selling history.html> \
//   CK_SAVED_SELLCART=<saved sell cart.html> \
//   CK_SAVED_BUYCART=<saved buy cart.html> bun test tests/
//
// A saved page carries an account's data and never enters the repository, so
// without the variables these tests skip.

import { test, expect, describe } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { Window } from "happy-dom";
import { CKB, text, cartSubtotal } from "./helpers.js";

const SAVED = { purchases: process.env.CK_SAVED_ORDERS, sales: process.env.CK_SAVED_SALES };
const CARTS = { sell: process.env.CK_SAVED_SELLCART, buy: process.env.CK_SAVED_BUYCART };
const CART_URL = { sell: "https://www.cardkingdom.com/sellcart", buy: "https://www.cardkingdom.com/cart" };

// The statuses the history pages' legend names, and a sale's finished one.
const KNOWN = ["BALANCE DUE", "CANCELED", "PRESALE", "PROCESSING", "READY SOON", "SHIPPED", "COMPLETED"];

// savedPage strips everything a saved page could fetch, and parses the rest
// in a window with no URL.
function savedPage(path) {
  const html = readFileSync(path, "utf8")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<(link|iframe|source|video)\b[^>]*>/gi, "")
    .replace(/\s(src|srcset)="[^"]*"/gi, "")
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

    test.skipIf(!SAVED[kind])("its pager agrees with its results line", () => {
      const place = CKB.historyPlace(savedPage(SAVED[kind]));
      expect(place.first).toBe(1);
      expect(place.last).toBe(25);
      expect(place.pages).toBe(Math.ceil(place.total / 25));
    });

    test.skipIf(!SAVED[kind])("left none of its order ids or dates in a fixture", () => {
      const rows = CKB.readHistory(savedPage(SAVED[kind]), kind);
      const fixtures = readdirSync(new URL("./fixtures/", import.meta.url)).map(text).join("\n").replace(/\s+/g, " ");
      expect(rows.map((row) => row.orderID).filter((id) => fixtures.includes(id))).toEqual([]);
      const dates = rows.flatMap((row) => [row.orderDate, row.completedOn]).filter(Boolean);
      expect(dates.filter((date) => fixtures.includes(date))).toEqual([]);
      expect(fixtures).not.toContain("of " + CKB.historyPlace(savedPage(SAVED[kind])).total + " results");
    });
  });
}

for (const side of ["sell", "buy"]) {
  describe("the saved " + side + " cart", () => {
    const saved = CARTS[side];
    const read = (doc) => CKB.readCart(doc, CART_URL[side], side);

    test.skipIf(!saved)("reads every line whole", () => {
      const lines = read(savedPage(saved));
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.map((l) => l.problem).filter(Boolean)).toEqual([]);
      expect(new Set(lines.map((l) => l.productID)).size).toBe(lines.length);
    });

    test.skipIf(!saved)("its line totals come to its subtotal", () => {
      const doc = savedPage(saved);
      expect(read(doc).reduce((cents, l) => cents + l.total, 0)).toBe(cartSubtotal(doc));
    });

    test.skipIf(!saved)("left none of its items or line ids in a fixture", () => {
      // The fixtures hold items drawn from the price list, never the cart's.
      const fixtures = readdirSync(new URL("./fixtures/", import.meta.url)).map(text).join("\n");
      const lines = read(savedPage(saved));
      expect(lines.map((l) => l.alt).filter((alt) => fixtures.includes(alt))).toEqual([]);
      const ids = lines.flatMap((l) => [l.lineID, l.productID]).map(String);
      expect(ids.filter((id) => new RegExp("\\b" + id + "\\b").test(fixtures))).toEqual([]);
    });
  });
}
