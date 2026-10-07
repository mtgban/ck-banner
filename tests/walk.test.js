import { test, expect, describe } from "bun:test";
import { CKB, docOf, load, pageOf, site } from "./helpers.js";

const ORDERS = "https://www.cardkingdom.com/myaccount/order_history";
const SALES = "https://www.cardkingdom.com/myaccount/selling_history";

const purchases = (total, change) => site("order-history.html", total, change);
const sales = (total, change) => site("selling-history.html", total, change);

function walk(kind, shop, options = {}) {
  return CKB.walkHistory(kind, kind === "sales" ? SALES : ORDERS, { pace: 0, fetchPage: shop.fetchPage, ...options });
}

describe("where a page sits", () => {
  test("reads the results line and the final page link", () => {
    expect(CKB.historyPlace(load("order-history.html"))).toEqual({ first: 1, last: 25, total: 210, pages: 9 });
  });

  test("reads grouped thousands", () => {
    const doc = docOf('<div class="orderHistoryWrapper"><div class="resultsCount">26 - 50 of 2,045 results</div></div>');
    expect(CKB.historyPlace(doc)).toEqual({ first: 26, last: 50, total: 2045, pages: null });
  });

  test("a page that does not say is refused", () => {
    expect(() => CKB.historyPlace(docOf("<p>Sign in</p>"))).toThrow("does not say how many orders");
  });
});

describe("walking the list", () => {
  test("every page lands in the one list, from page 1", async () => {
    const shop = purchases(60);
    const walked = await walk("purchases", shop);
    expect(shop.asked).toEqual([ORDERS + "?page=1", ORDERS + "?page=2", ORDERS + "?page=3"]);
    expect(walked.rows.length).toBe(60);
    expect(new Set(walked.rows.map((row) => row.orderID)).size).toBe(60);
    expect(walked).toMatchObject({ pages: 3, pageCount: 3, total: 60, stoppedEarly: false, cancelled: false });
  });

  test("a single page needs no pager", async () => {
    const shop = purchases(10, { 1: (doc) => (doc.querySelector('a[aria-label="Display Final Results Page"]').remove(), doc) });
    const walked = await walk("purchases", shop);
    expect(shop.asked.length).toBe(1);
    expect(walked.rows.length).toBe(10);
  });

  test("says how far it has got", async () => {
    const seen = [];
    await walk("purchases", purchases(60), { progress: (n, pages) => seen.push(n + "/" + pages) });
    expect(seen).toEqual(["1/3", "2/3", "3/3"]);
  });
});

describe("refusing a list it did not read whole", () => {
  test("a page that comes back short is refused", async () => {
    const shop = purchases(60, {
      2: (doc) => {
        [...doc.querySelectorAll("tr")].filter((tr) => tr.querySelector("td")).slice(11).forEach((tr) => tr.remove());
        return doc;
      },
    });
    await expect(walk("purchases", shop)).rejects.toThrow("Page 2 came back with 11 of 25 orders, so nothing was saved");
  });

  test("a list that grows while it is read is refused", async () => {
    const shop = purchases(60, { 2: () => pageOf("order-history.html", { n: 2, total: 61 }) });
    await expect(walk("purchases", shop)).rejects.toThrow("The history changed while it was read (page 2)");
  });

  test("a page out of place is refused", async () => {
    // Synthetic: page 2 answered with page 1.
    const shop = purchases(60, { 2: () => pageOf("order-history.html", { n: 1, total: 60 }) });
    await expect(walk("purchases", shop)).rejects.toThrow("The history changed while it was read (page 2)");
  });

  test("an order listed twice is refused", async () => {
    // Synthetic: page 2 in its right place, holding page 1's first order.
    const shop = purchases(60, {
      2: (doc) => {
        doc.querySelector("td a").textContent = "1000001";
        return doc;
      },
    });
    await expect(walk("purchases", shop)).rejects.toThrow("Order 1000001 was listed twice");
  });

  test("a pager that disagrees with the count is refused", async () => {
    const shop = purchases(60, {
      1: (doc) => {
        doc.querySelector('a[aria-label="Display Final Results Page"]').textContent = " 4 ";
        return doc;
      },
    });
    await expect(walk("purchases", shop)).rejects.toThrow("The history holds 60 orders at 25 a page, but its pager says 4 pages");
  });

  test("a page with no history on it is refused", async () => {
    // What a sign-in page in place of page 2 would look like.
    const shop = purchases(60, { 2: () => docOf('<form><input name="email"></form>') });
    await expect(walk("purchases", shop)).rejects.toThrow("There is no history table on the page");
  });

  test("a Cloudflare challenge stops the walk where it is", async () => {
    const shop = purchases(60, { 2: () => new Error(CKB.CHALLENGE) });
    await expect(walk("purchases", shop)).rejects.toThrow(CKB.CHALLENGE);
    expect(shop.asked.length).toBe(2);
  });
});

describe("stopping early", () => {
  // Eight pages, a year apart: 2026 on page 1, 2025 on page 2, and so on.

  test("purchases stop after the first page holding an older year", async () => {
    const shop = purchases(200);
    const walked = await walk("purchases", shop, { year: 2025 });
    expect(shop.asked.length).toBe(3);
    expect(walked.stoppedEarly).toBe(true);
    expect(walked.rows.filter((row) => row.ordered.year === 2025).length).toBe(25);
  });

  test("purchases out of order do not stop early", async () => {
    // Synthetic: one order on page 2 dated after everything on page 1.
    const shop = purchases(200, {
      2: (doc) => {
        doc.querySelector("td#order_date").textContent = "Dec 31, 2026 11:59 PM";
        return doc;
      },
    });
    const walked = await walk("purchases", shop, { year: 2025 });
    expect(shop.asked.length).toBe(8);
    expect(walked.stoppedEarly).toBe(false);
  });

  test("sales never stop early", async () => {
    const shop = sales(200);
    const walked = await walk("sales", shop, { year: 2025 });
    expect(shop.asked.length).toBe(8);
    expect(walked.stoppedEarly).toBe(false);
  });

  test("every year reads every page", async () => {
    const shop = purchases(200);
    await walk("purchases", shop);
    expect(shop.asked.length).toBe(8);
  });
});

describe("pace and cancelling", () => {
  test("it waits before each page after the first", async () => {
    const shop = purchases(60);
    const at = [];
    const started = Date.now();
    await walk("purchases", shop, {
      pace: 40,
      fetchPage: (url) => {
        at.push(Date.now() - started);
        return shop.fetchPage(url);
      },
    });
    expect(at[0]).toBeLessThan(30);
    expect(at[1] - at[0]).toBeGreaterThanOrEqual(35);
    expect(at[2] - at[1]).toBeGreaterThanOrEqual(35);
  });

  test("a cancelled walk keeps nothing", async () => {
    const shop = purchases(60);
    let stop = false;
    const walked = await walk("purchases", shop, { progress: () => (stop = true), cancelled: () => stop });
    expect(shop.asked.length).toBe(1);
    expect(walked.cancelled).toBe(true);
    expect(walked.rows).toEqual([]);
  });

  test("a page that arrives after cancelling is dropped", async () => {
    const shop = purchases(60);
    const seen = [];
    let stop = false;
    const walked = await walk("purchases", shop, {
      progress: (n) => seen.push(n),
      cancelled: () => stop,
      fetchPage: (url) => {
        stop = true;
        return shop.fetchPage(url);
      },
    });
    expect(walked.cancelled).toBe(true);
    expect(walked.rows).toEqual([]);
    expect(seen).toEqual([]);
  });
});
