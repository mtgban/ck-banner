import { test, expect, describe } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { CKB, docOf, pageHTML } from "./helpers.js";
import { mountHistory } from "./panel.js";

// The fixtures' list puts 2026 on page 1, 2025 on page 2, and so on back.
const NOW = new Date().getFullYear();

describe("the panel", () => {
  test("appears on the order history as purchases", () => {
    const it = mountHistory();
    expect(it.heading()).toBe("CK BANner - purchases");
    expect(it.go().textContent).toBe("Download CSV");
    expect(it.panel.hidden).toBe(false);
  });

  test("appears on the selling history as sales", () => {
    expect(mountHistory({ kind: "sales" }).heading()).toBe("CK BANner - sales");
  });

  test("stays hidden on a page with no history table", () => {
    expect(mountHistory({ body: '<form><input name="email"></form>' }).panel.hidden).toBe(true);
  });

  test("offers every year back to 1999 and All years, this year first", () => {
    const options = [...mountHistory().year().options].map((option) => option.value);
    expect(options[0]).toBe("all");
    expect(options[1]).toBe(String(NOW));
    expect(options.at(-1)).toBe("1999");
    expect(options.length).toBe(NOW - 1999 + 2);
    expect(mountHistory().year().value).toBe(String(NOW));
  });

  test("the tooltip says what the file will hold", () => {
    const it = mountHistory();
    it.choose("2025");
    expect(it.tip()).toBe("Every shipped, paid purchase ordered in 2025, as a CSV with one row per order");
    it.choose("all");
    expect(it.tip()).toBe("Every shipped, paid purchase, as a CSV with one row per order");
    const sales = mountHistory({ kind: "sales" });
    sales.choose("2025");
    expect(sales.tip()).toBe("Every completed, paid sale Card Kingdom received in 2025, as a CSV with one row per order");
  });

  test("carries no title and nothing under its row", () => {
    const it = mountHistory();
    expect(it.titled()).toBe(0);
    expect(it.below()).toBe(0);
  });
});

describe("downloading", () => {
  test("reads the list and saves the year's orders", async () => {
    const it = mountHistory();
    it.choose("2026");
    it.go().click();
    expect(it.busy()).toBe(true);
    expect(it.go().disabled).toBe(true);
    expect(it.year().disabled).toBe(true);
    expect(it.tip()).toBe("");
    await it.settle();

    // Page 2 holds 2025, older than the year asked for, so the walk ends there.
    expect(it.asked).toEqual([
      "https://www.cardkingdom.com/myaccount/order_history?page=1",
      "https://www.cardkingdom.com/myaccount/order_history?page=2",
    ]);
    const file = await it.file();
    expect(file.name).toBe("ck-purchases-2026.csv");
    const lines = file.text.trimEnd().split("\n");
    expect(lines[0]).toBe("Order ID,Order Status,Order Date,Completed on,Amount");
    expect(lines.length).toBe(26);
    expect(lines[1]).toMatch(/^1000001,SHIPPED,"[A-Z][a-z]{2} \d{1,2}, 2026 \d\d:\d\d [AP]M","[A-Z][a-z]{2} \d{1,2}, 2026 /);

    expect(it.heading()).toBe("CK BANner - 25 shipped\u2713");
    expect(it.failed()).toBe(false);
    expect(it.busy()).toBe(false);
    expect(it.go().disabled).toBe(false);
    expect(it.tip()).toBe(
      "Saved ck-purchases-2026.csv: 25 orders, filed by order date. Read 2 pages; left out 25 from other years."
    );
  });

  test("sales are read until a page is past the year, filed by the date received", async () => {
    const it = mountHistory({ kind: "sales", total: 60 });
    it.choose("2026");
    it.go().click();
    await it.settle();
    expect(it.asked.length).toBe(2);
    const file = await it.file();
    expect(file.name).toBe("ck-sales-2026.csv");
    expect(file.text.trimEnd().split("\n").length).toBe(20);
    expect(it.heading()).toBe("CK BANner - 19 completed\u2713");
    // Two full pages of 19 completed and 6 cancelled sales.
    expect(it.tip()).toBe(
      "Saved ck-sales-2026.csv: 19 orders, filed by the date Card Kingdom received them. Read 2 pages; left out 12 CANCELED, 19 from other years."
    );
  });

  test("All years reads every page and saves every order", async () => {
    const it = mountHistory({ total: 60 });
    it.choose("all");
    it.go().click();
    await it.settle();
    expect(it.asked.length).toBe(3);
    const file = await it.file();
    expect(file.name).toBe("ck-purchases-all.csv");
    expect(file.text.trimEnd().split("\n").length).toBe(61);
    expect(it.heading()).toBe("CK BANner - 60 shipped\u2713");
  });

  test("no file is offered when nothing matches", async () => {
    const it = mountHistory({ total: 60 });
    it.choose("2010");
    it.go().click();
    await it.settle();
    expect(it.saved).toEqual([]);
    expect(it.heading()).toBe("CK BANner - purchases\u2717");
    expect(it.failed()).toBe(true);
    expect(it.tip()).toBe("No shipped, paid purchases in 2010; read 3 pages.");
  });

  test("a refused walk says why and saves nothing", async () => {
    const it = mountHistory({ change: { 2: () => new Error("Card Kingdom is checking the browser; reload and try again") } });
    it.choose("all");
    it.go().click();
    await it.settle();
    expect(it.saved).toEqual([]);
    expect(it.failed()).toBe(true);
    expect(it.heading()).toBe("CK BANner - purchases\u2717");
    expect(it.tip()).toBe("Card Kingdom is checking the browser; reload and try again");
    expect(it.go().disabled).toBe(false);
  });

  test("a completed sale with no Received date refuses the file", async () => {
    // Synthetic: the first completed row on page 1 loses its date.
    const it = mountHistory({
      kind: "sales",
      total: 25,
      change: { 1: (html) => html.replace(/<span>Received [^<]*<\/span>/, "") },
    });
    it.choose("all");
    it.go().click();
    await it.settle();
    expect(it.saved).toEqual([]);
    expect(it.tip()).toBe("Order 2000003 is COMPLETED but carries no date to file it under");
  });
});

describe("stopping and leaving", () => {
  test("Escape stops the walk and saves nothing", async () => {
    let release;
    const held = new Promise((resume) => (release = resume));
    const it = mountHistory({ change: { 2: (html) => held.then(() => html) } });
    it.choose("all");
    it.go().click();
    await it.settle();
    expect(it.busy()).toBe(true);
    expect(it.word()).toBe("page 1");

    it.escape();
    expect(it.busy()).toBe(false);
    expect(it.heading()).toBe("CK BANner - purchases");
    release();
    await it.settle();
    expect(it.asked.length).toBe(2);
    expect(it.saved).toEqual([]);
    expect(it.heading()).toBe("CK BANner - purchases");
  });

  test("the page is held only while it reads", async () => {
    const it = mountHistory({ total: 25 });
    expect(it.leaving()).toBe(false);
    it.go().click();
    expect(it.leaving()).toBe(true);
    await it.settle();
    expect(it.leaving()).toBe(false);
  });

  test("choosing another year clears the last result", async () => {
    const it = mountHistory({ total: 25 });
    it.choose("2026");
    it.go().click();
    await it.settle();
    expect(it.markShown()).toBe(true);
    it.choose("2025");
    expect(it.markShown()).toBe(false);
    expect(it.heading()).toBe("CK BANner - purchases");
    expect(it.tip()).toBe("Every shipped, paid purchase ordered in 2025, as a CSV with one row per order");
  });
});

describe("the kept file", () => {
  const ORDERS = "https://www.cardkingdom.com/myaccount/order_history";

  async function downloaded(it, value = "all") {
    it.choose(value);
    it.go().click();
    await it.settle();
  }

  test("a second download reads page 1 alone and hands out the kept file", async () => {
    const it = mountHistory({ total: 60 });
    await downloaded(it);
    // The walk reused the page 1 it was handed: three pages, three requests.
    expect(it.asked.length).toBe(3);
    it.go().click();
    await it.settle();
    expect(it.asked.slice(3)).toEqual([ORDERS + "?page=1"]);
    expect((await it.file(1)).text).toBe((await it.file(0)).text);
    expect(it.go().textContent).toBe("Rebuild");
    expect(it.heading()).toBe("CK BANner - 60 shipped\u2713");
    expect(it.tip()).toMatch(
      /^Saved ck-purchases-all\.csv again, as built at \d\d:\d\d from 3 pages: page 1 has not changed since\. Rebuild reads the list again\.$/
    );
  });

  test("Rebuild reads the list again", async () => {
    const it = mountHistory({ total: 60 });
    await downloaded(it);
    it.go().click();
    await it.settle();
    it.go().click();
    await it.settle();
    expect(it.asked.length).toBe(3 + 1 + 3);
    expect(it.go().textContent).toBe("Download CSV");
  });

  test("a changed page 1 reads the list again", async () => {
    const change = {};
    const it = mountHistory({ total: 60, change });
    await downloaded(it);
    // Synthetic: the newest order's ship date moved.
    change[1] = (html) => html.replace(/Shipped\s+[A-Z][a-z]{2} \d{1,2}, 2026 \d\d:\d\d [AP]M/, "Shipped Feb 28, 2026 11:00 PM");
    it.go().click();
    await it.settle();
    expect(it.asked.length).toBe(6);
    expect(it.go().textContent).toBe("Download CSV");
  });

  test("a failed walk keeps the file it had", async () => {
    const change = {};
    const it = mountHistory({ total: 60, change });
    await downloaded(it);
    change[1] = (html) => html.replace(/Shipped\s+[A-Z][a-z]{2} \d{1,2}, 2026 \d\d:\d\d [AP]M/, "Shipped Feb 28, 2026 11:00 PM");
    change[2] = () => new Error("Card Kingdom is checking the browser; reload and try again");
    it.go().click();
    await it.settle();
    expect(it.failed()).toBe(true);
    delete change[1];
    delete change[2];
    it.go().click();
    await it.settle();
    expect(it.go().textContent).toBe("Rebuild");
    expect(it.saved.length).toBe(2);
  });

  test("a year with nothing to save keeps nothing", async () => {
    const it = mountHistory({ total: 60 });
    await downloaded(it, "2010");
    await downloaded(it, "2010");
    expect(it.asked.length).toBe(6);
    expect(it.saved).toEqual([]);
    expect(it.failed()).toBe(true);
  });

  test("a year is cut from the kept every-year file, with no walk", async () => {
    const it = mountHistory({ total: 60 });
    await downloaded(it, "all");
    await downloaded(it, "2026");
    expect(it.asked.length).toBe(3 + 1);
    expect(it.saved.map((s) => s.name)).toEqual(["ck-purchases-all.csv", "ck-purchases-2026.csv"]);
    expect((await it.file(1)).text.trimEnd().split("\n").length).toBe(26);
    expect(it.go().textContent).toBe("Rebuild");
    expect(it.tip()).toMatch(
      /^Saved ck-purchases-2026\.csv from the every-year list built at \d\d:\d\d: page 1 has not changed since\. Rebuild reads the list again\.$/
    );
    // Rebuild reads that year from the list itself.
    it.go().click();
    await it.settle();
    expect(it.asked.length).toBe(3 + 1 + 2);
  });

  test("each year keeps its own file", async () => {
    const it = mountHistory({ total: 60 });
    await downloaded(it, "2026");
    await downloaded(it, "2025");
    expect(it.go().textContent).toBe("Download CSV");
    expect(it.saved.map((s) => s.name)).toEqual(["ck-purchases-2026.csv", "ck-purchases-2025.csv"]);
  });

  test("a file kept for every year a day ago is built again", async () => {
    const idb = new IDBFactory();
    const page1 = docOf(pageHTML("order-history.html", { n: 1, total: 60 }));
    const store = await CKB.openStore(idb);
    await store.put(CKB.fileKey("purchases", null), {
      v: CKB.FILE_VERSION,
      signature: CKB.historySignature(page1, "purchases"),
      csv: "old\n",
      name: "ck-purchases-all.csv",
      count: 1,
      read: "3 pages",
      builtAt: Date.now() - CKB.FILE_TTL,
    });
    const it = mountHistory({ total: 60, idb });
    await downloaded(it);
    expect(it.asked.length).toBe(3);
    expect((await it.file(0)).text).not.toBe("old\n");
  });

  test("a past year's file kept for weeks is still handed out", async () => {
    const idb = new IDBFactory();
    const page1 = docOf(pageHTML("order-history.html", { n: 1, total: 60 }));
    const store = await CKB.openStore(idb);
    await store.put(CKB.fileKey("purchases", 2020), {
      v: CKB.FILE_VERSION,
      signature: CKB.historySignature(page1, "purchases"),
      csv: "kept\n",
      name: "ck-purchases-2020.csv",
      count: 1,
      read: "3 pages",
      builtAt: Date.now() - 21 * CKB.FILE_TTL,
    });
    const it = mountHistory({ total: 60, idb });
    await downloaded(it, "2020");
    expect(it.asked.length).toBe(1);
    expect((await it.file(0)).text).toBe("kept\n");
  });
});
