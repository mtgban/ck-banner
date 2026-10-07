import { test, expect, describe } from "bun:test";
import { CKB } from "./helpers.js";

const shipped = {
  orderID: "1000001",
  status: "SHIPPED",
  orderDate: "Mar 14, 2026 10:36 AM",
  completedOn: "Mar 16, 2026 10:10 PM",
  amount: "$1,234.56",
};

describe("the columns", () => {
  test("the header is the contract", () => {
    expect(CKB.csvColumns().join(",")).toBe("Order ID,Order Status,Order Date,Completed on,Amount");
  });

  test("a field outside the five is never written", () => {
    const csv = CKB.toCSV([{ ...shipped, shipTo: "1 Example Street", tracking: "1Z999" }]);
    expect(csv).not.toContain("Example Street");
    expect(csv).not.toContain("1Z999");
  });
});

describe("the writing", () => {
  test("a row is written as Go's csv.Writer writes it", () => {
    // Bytes taken from a csv.Writer given the same row.
    expect(CKB.toCSV([shipped])).toBe(
      "Order ID,Order Status,Order Date,Completed on,Amount\n" +
        '1000001,SHIPPED,"Mar 14, 2026 10:36 AM","Mar 16, 2026 10:10 PM","$1,234.56"\n'
    );
  });

  test("a comma is quoted", () => {
    expect(CKB.toCSV([{ ...shipped, amount: "$1,000.00" }])).toContain(',"$1,000.00"\n');
  });

  test("a quote is doubled and a line break is quoted", () => {
    const csv = CKB.toCSV([{ ...shipped, orderID: 'a "b"', status: "two\nlines" }]);
    expect(csv).toContain('"a ""b""","two\nlines",');
  });

  test("a missing value is an empty field", () => {
    expect(CKB.toCSV([{ ...shipped, completedOn: undefined }])).toContain(',"Mar 14, 2026 10:36 AM",,"$1,234.56"\n');
  });

  test("rows keep their order and every line ends", () => {
    const csv = CKB.toCSV([shipped, { ...shipped, orderID: "1000002" }]);
    const lines = csv.split("\n");
    expect(lines.map((line) => line.split(",")[0])).toEqual(["Order ID", "1000001", "1000002", ""]);
  });

  test("no rows is the header alone", () => {
    expect(CKB.toCSV([])).toBe("Order ID,Order Status,Order Date,Completed on,Amount\n");
  });
});
