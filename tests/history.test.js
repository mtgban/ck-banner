import { test, expect, describe } from "bun:test";
import { CKB, docOf, load } from "./helpers.js";

const purchases = () => load("order-history.html");
const sales = () => load("selling-history.html");

// cell is row i's cell under the named header, i counting data rows from 0.
function cell(doc, i, name) {
  const heads = [...doc.querySelectorAll("th")].map((th) => th.textContent.trim());
  const row = [...doc.querySelectorAll("tr")].filter((tr) => tr.querySelector("td"))[i];
  return row.querySelectorAll("td")[heads.indexOf(name)];
}

// set rewrites one cell of row i; every row a test builds this way is
// synthetic and says so here.
function set(doc, i, name, html) {
  cell(doc, i, name).innerHTML = html;
  return doc;
}

describe("the order history", () => {
  test("reads every row", () => {
    const rows = CKB.readHistory(purchases(), "purchases");
    expect(rows.length).toBe(25);
    expect(rows[0].orderID).toBe("1000001");
    expect(rows.every((row) => row.status === "SHIPPED" && row.paid === "Paid")).toBe(true);
  });

  test("keeps every value as printed", () => {
    const row = CKB.readHistory(purchases(), "purchases")[0];
    expect(row.orderDate).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4} \d{2}:\d{2} [AP]M$/);
    expect(row.completedOn).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4} \d{2}:\d{2} [AP]M$/);
    expect(row.amount).toMatch(/^\$[\d,]+\.\d{2}$/);
    expect(row.ordered.year).toBe(Number(row.orderDate.match(/\d{4}/)[0]));
  });

  test("never reads the address or the tracking link", () => {
    const doc = purchases();
    set(doc, 0, "Ship To", "1 Example Street");
    const read = JSON.stringify(CKB.readHistory(doc, "purchases"));
    expect(read).not.toContain("Example Street");
    expect(read).not.toContain("track");
  });
});

describe("the selling history", () => {
  test("reads the page's misspelled status cell", () => {
    // The status cell's attribute is "id-", so it is found by its header.
    const doc = sales();
    expect(doc.querySelector('td[id="order_status"]')).toBeNull();
    const rows = CKB.readHistory(doc, "sales");
    expect(rows.length).toBe(25);
    expect(rows.filter((row) => row.status === "COMPLETED").length).toBe(19);
    expect(rows.filter((row) => row.status === "CANCELED").length).toBe(6);
  });

  test("a completed sale carries its Received date", () => {
    const done = CKB.readHistory(sales(), "sales").filter((row) => row.status === "COMPLETED");
    expect(done.every((row) => row.paid === "Paid" && row.completed && row.completed.hour === null)).toBe(true);
    expect(done[0].completedOn).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
  });

  test("a cancelled sale is unpaid and has no date", () => {
    const cancelled = CKB.readHistory(sales(), "sales").filter((row) => row.status === "CANCELED");
    expect(cancelled.every((row) => row.paid === "Unpaid" && row.completedOn === "" && row.completed === null)).toBe(true);
  });
});

describe("columns are found by their header", () => {
  test("columns are found by their header, wherever they sit", () => {
    // Synthetic: Total moved to the front, header and cells alike.
    const doc = purchases();
    const before = CKB.readHistory(doc, "purchases");
    for (const tr of doc.querySelectorAll("tr")) {
      tr.insertBefore(tr.lastElementChild, tr.firstElementChild);
    }
    expect(CKB.readHistory(doc, "purchases")).toEqual(before);
  });

  test("a missing column refuses the page and names it", () => {
    const doc = purchases();
    [...doc.querySelectorAll("th")].find((th) => th.textContent.trim() === "Total").textContent = "Amount";
    expect(() => CKB.readHistory(doc, "purchases")).toThrow("The history table has no Total column");
  });

  test("the other page's table is refused", () => {
    expect(() => CKB.readHistory(sales(), "purchases")).toThrow("no Ship To column");
    expect(() => CKB.readHistory(purchases(), "sales")).toThrow("no Mailing Address column");
  });

  test("a row short of a cell is refused", () => {
    const doc = purchases();
    cell(doc, 3, "Total").remove();
    expect(() => CKB.readHistory(doc, "purchases")).toThrow("A history row could not be read");
  });
});

describe("a page it cannot read whole", () => {
  test("a page with no table is refused", () => {
    // What a sign-in page or an error would look like: no history at all.
    expect(() => CKB.readHistory(docOf("<form><input name=email></form>"), "purchases")).toThrow(
      "There is no history table on the page"
    );
  });

  test("a table with no header row is refused", () => {
    const doc = purchases();
    doc.querySelector("tr").remove();
    expect(() => CKB.readHistory(doc, "purchases")).toThrow("no header row");
  });

  test("an order date that cannot be read refuses the page and names the order", () => {
    const doc = set(purchases(), 2, "Order Date", "24 Sep 2026 10:36");
    expect(() => CKB.readHistory(doc, "purchases")).toThrow("Order 1000003 has an order date that could not be read");
  });

  test("a status date that cannot be read refuses the page", () => {
    const doc = set(sales(), 2, "Status", "COMPLETED<br><span>Received Mar. 5, 2026</span>");
    expect(() => CKB.readHistory(doc, "sales")).toThrow("Order 2000003 has a status date that could not be read");
  });

  test("a total that cannot be read refuses the page", () => {
    const doc = set(purchases(), 0, "Total", "$1.234");
    expect(() => CKB.readHistory(doc, "purchases")).toThrow("Order 1000001 has a total that could not be read");
  });

  test("an unknown page is refused", () => {
    expect(() => CKB.readHistory(purchases(), "orders")).toThrow("Unknown history: orders");
  });
});

describe("which rows are exported", () => {
  test("every shipped and paid purchase is exported", () => {
    const rows = CKB.readHistory(purchases(), "purchases");
    expect(rows.filter((row) => CKB.exported(row, "purchases")).length).toBe(25);
  });

  test("every completed and paid sale is exported, and nothing else", () => {
    const rows = CKB.readHistory(sales(), "sales");
    expect(rows.filter((row) => CKB.exported(row, "sales")).length).toBe(19);
  });

  test("only the finished status is exported, paid or not", () => {
    // Synthetic: a paid order that has not shipped yet.
    const doc = set(purchases(), 0, "Status", " PROCESSING <br>");
    const rows = CKB.readHistory(doc, "purchases");
    expect(rows[0].paid).toBe("Paid");
    expect(CKB.exported(rows[0], "purchases")).toBe(false);
    expect(CKB.exported({ ...rows[1], status: "PARTIALLY SHIPPED" }, "purchases")).toBe(false);
    expect(CKB.exported({ ...rows[1], status: "COMPLETED" }, "purchases")).toBe(false);
  });

  test("an unpaid row is not exported", () => {
    // Synthetic: a completed sale still marked Unpaid.
    const doc = sales();
    const i = CKB.readHistory(doc, "sales").findIndex((row) => row.status === "COMPLETED");
    set(doc, i, "Payment Method", ' STORECREDIT <br> <span id="paid_status">Unpaid</span><br>');
    expect(CKB.exported(CKB.readHistory(doc, "sales")[i], "sales")).toBe(false);
  });
});

describe("which year a row is filed under", () => {
  test("a purchase is filed under the year it was ordered", () => {
    // Synthetic: ordered a minute before the new year, shipped after it.
    const doc = set(purchases(), 0, "Order Date", " Dec 31, 2025 11:59 PM ");
    set(doc, 0, "Status", ' SHIPPED <br><span>Shipped Jan 2, 2026 10:10 AM</span>');
    expect(CKB.yearOf(CKB.readHistory(doc, "purchases")[0], "purchases")).toBe(2025);
  });

  test("a sale is filed under the year it was received", () => {
    // Synthetic: ordered Dec 29, received Jan 3.
    const doc = sales();
    const i = CKB.readHistory(doc, "sales").findIndex((row) => row.status === "COMPLETED");
    set(doc, i, "Order Date", " Dec 29, 2025 04:00 PM ");
    set(doc, i, "Status", " COMPLETED <br><span>Received Jan 3, 2026</span>");
    expect(CKB.yearOf(CKB.readHistory(doc, "sales")[i], "sales")).toBe(2026);
  });

  test("a sale with no Received date has no year", () => {
    const rows = CKB.readHistory(sales(), "sales");
    expect(CKB.yearOf(rows.find((row) => row.status === "CANCELED"), "sales")).toBeNull();
  });
});

describe("picking a year's rows", () => {
  test("a year holds only its own orders, and says what it left out", () => {
    // Synthetic: one sale from page 1 moved to the year before.
    const doc = sales();
    const i = CKB.readHistory(doc, "sales").findIndex((row) => row.status === "COMPLETED");
    set(doc, i, "Status", " COMPLETED <br><span>Received Dec 30, 2025</span>");
    const picked = CKB.pick(CKB.readHistory(doc, "sales"), "sales", 2026);
    expect(picked.rows.length).toBe(18);
    expect(picked.otherYears).toBe(1);
    expect(picked.skipped).toEqual({ CANCELED: 6 });
    expect(picked.unpaid).toBe(0);
  });

  test("every year takes every exported row", () => {
    const picked = CKB.pick(CKB.readHistory(sales(), "sales"), "sales", null);
    expect(picked.rows.length).toBe(19);
    expect(picked.otherYears).toBe(0);
  });

  test("an unpaid row in the finished status is counted as unpaid", () => {
    const doc = sales();
    const i = CKB.readHistory(doc, "sales").findIndex((row) => row.status === "COMPLETED");
    set(doc, i, "Payment Method", ' STORECREDIT <br> <span id="paid_status">Unpaid</span><br>');
    const picked = CKB.pick(CKB.readHistory(doc, "sales"), "sales", null);
    expect(picked.unpaid).toBe(1);
    expect(picked.rows.length).toBe(18);
  });

  test("a row it would export with no date to file it under refuses", () => {
    const doc = sales();
    const i = CKB.readHistory(doc, "sales").findIndex((row) => row.status === "COMPLETED");
    set(doc, i, "Status", " COMPLETED <br>");
    expect(() => CKB.pick(CKB.readHistory(doc, "sales"), "sales", 2026)).toThrow(
      "Order 2000003 is COMPLETED but carries no date to file it under"
    );
  });
});
