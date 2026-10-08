import { test, expect, describe } from "bun:test";
import { CKB, load } from "./helpers.js";

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

describe("the cart file", () => {
  const cart = (name, side) => CKB.cartCSV(CKB.readCart(load(name), "https://www.cardkingdom.com/" + (side === "sell" ? "sellcart" : "cart"), side));

  test("writes each sell line as the page shows it", () => {
    const lines = cart("sell-cart.html", "sell").split("\n");
    expect(lines.slice(0, 3)).toEqual([
      "Name,Edition,Foil,Condition,Quantity,Price,Total,CK ID",
      "Necropotence,Eternal Masters,No,NM,1,27.00,27.00,206649",
      "Bleeding Edge,War of the Spark,Yes,NM,1,0.10,0.10,224590",
    ]);
    expect(lines.length).toBe(1 + 10 + 1);
    expect(lines[lines.length - 1]).toBe("");
  });

  test("keeps a variation in the name and a colon in the edition", () => {
    const lines = cart("sell-cart.html", "sell").split("\n");
    expect(lines).toContain("Manor Gate (Commander Legends: Battle for Baldur's Gate),Mystery Booster/The List,No,NM,1,1.00,1.00,307429");
    expect(lines).toContain("Moon-Circuit Hacker,Kamigawa: Neon Dynasty,No,NM,1,0.25,0.25,256266");
    expect(lines).toContain('"Jin-Gitaxias, Core Augur",Mystery Booster/The List,No,NM,4,6.00,24.00,256544');
  });

  test("names each buy line's condition", () => {
    const lines = cart("buy-cart.html", "buy").split("\n");
    expect(lines.slice(1, 5)).toEqual([
      "Baneful Omen,Rise of the Eldrazi,No,NM,1,2.99,2.99,130810",
      "Prophetic Prism,Masters 25,Yes,EX,1,0.39,0.39,217590",
      "Mana Flare,4th Edition,No,VG,2,1.74,3.48,10202",
      "Thunderheads,Guildpact,No,G,1,0.18,0.18,119725",
    ]);
  });

  test("writes a line it could not read whole with what was read", () => {
    const doc = load("sell-cart.html");
    doc.querySelector(".item-price-wrapper small").textContent = "";
    const line = CKB.cartCSV(CKB.readCart(doc, "https://www.cardkingdom.com/sellcart", "sell")).split("\n")[1];
    expect(line).toBe("Necropotence,Eternal Masters,No,NM,1,,27.00,206649");
  });
});
