import { test, expect, describe } from "bun:test";
import { CKB, load, text } from "./helpers.js";

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
  const listOf = (edit = (body) => body) => CKB.reducePrices(edit(JSON.parse(text("pricelist.json"))), Date.now());
  const read = (name, side) => CKB.readCart(load(name), "https://www.cardkingdom.com/" + (side === "sell" ? "sellcart" : "cart"), side);
  const cart = (name, side, list = listOf()) => CKB.cartCSV(read(name, side), list).split("\n");

  test("writes each sell line as the page shows it, with its Scryfall id", () => {
    const lines = cart("sell-cart.html", "sell");
    expect(lines.slice(0, 3)).toEqual([
      "Scryfall ID,Name,Edition,Foil,Condition,Quantity,Price,Total,CK ID",
      "57ffb8ad-d8b4-4764-bbb0-ca4106080a90,Necropotence,Eternal Masters,No,NM,1,27.00,27.00,206649",
      "ac82422c-8ac8-4fbb-b9b9-d0aa23dded61,Bleeding Edge,War of the Spark,Yes,NM,1,0.10,0.10,224590",
    ]);
    expect(lines.length).toBe(1 + 10 + 1);
    expect(lines[lines.length - 1]).toBe("");
  });

  test("keeps a variation in the name and a colon in the edition", () => {
    const lines = cart("sell-cart.html", "sell");
    expect(lines).toContain(
      "08a1a78c-f715-4d92-a428-bcc409bdbd79,Manor Gate (Commander Legends: Battle for Baldur's Gate),Mystery Booster/The List,No,NM,1,1.00,1.00,307429"
    );
    expect(lines).toContain("c6e466d1-943d-41e6-a47d-c9d951ca4262,Moon-Circuit Hacker,Kamigawa: Neon Dynasty,No,NM,1,0.25,0.25,256266");
    expect(lines).toContain('b67c1a50-6e13-4715-a76c-faf0d9b3e397,"Jin-Gitaxias, Core Augur",Mystery Booster/The List,No,NM,4,6.00,24.00,256544');
  });

  test("names each buy line's condition", () => {
    expect(cart("buy-cart.html", "buy").slice(1, 5)).toEqual([
      "2bff6e03-b6af-4f54-b365-9a6db2dbb595,Baneful Omen,Rise of the Eldrazi,No,NM,1,2.99,2.99,130810",
      "aecd6741-bab2-4921-b961-ea1584213558,Prophetic Prism,Masters 25,Yes,EX,1,0.39,0.39,217590",
      "e7169e26-e700-4e71-b959-4592a03f3c9f,Mana Flare,4th Edition,No,VG,2,1.74,3.48,10202",
      "56de9727-021e-4b37-b80b-08dcd898aec0,Thunderheads,Guildpact,No,G,1,0.18,0.18,119725",
    ]);
  });

  test("leaves the Scryfall id out with no list, or a row naming another card", () => {
    expect(cart("sell-cart.html", "sell", null)[1]).toBe(",Necropotence,Eternal Masters,No,NM,1,27.00,27.00,206649");
    // Synthetic: 206649's row names another card.
    const other = listOf((body) => ({ ...body, data: body.data.map((r) => (r.id === 206649 ? { ...r, name: "Dark Ritual" } : r)) }));
    expect(cart("sell-cart.html", "sell", other)[1]).toBe(",Necropotence,Eternal Masters,No,NM,1,27.00,27.00,206649");
  });

  test("leaves the Scryfall id out where the list has none or a malformed one", () => {
    // Synthetic: CK publishes no id for one row and a truncated one for another.
    const list = listOf((body) => ({
      ...body,
      data: body.data.map((r) => (r.id === 206649 ? { ...r, scryfall_id: null } : r.id === 224590 ? { ...r, scryfall_id: r.scryfall_id.slice(0, 35) } : r)),
    }));
    const lines = cart("sell-cart.html", "sell", list);
    expect([lines[1].startsWith(","), lines[1].endsWith(",206649")]).toEqual([true, true]);
    expect([lines[2].startsWith(","), lines[2].endsWith(",224590")]).toEqual([true, true]);
  });

  test("gives a line with no product id both ids from its card", () => {
    // As on a signed-out cart, which has no Save for Later to carry one.
    const lines = read("sell-cart.html", "sell").map((l) => ({ ...l, productID: null }));
    expect(CKB.cartCSV(lines, listOf()).split("\n")[1]).toBe(
      "57ffb8ad-d8b4-4764-bbb0-ca4106080a90,Necropotence,Eternal Masters,No,NM,1,27.00,27.00,206649"
    );
    expect(CKB.cartCSV(lines, null).split("\n")[1]).toBe(",Necropotence,Eternal Masters,No,NM,1,27.00,27.00,");
  });

  test("writes a line it could not read whole with what was read", () => {
    const doc = load("sell-cart.html");
    doc.querySelector(".item-price-wrapper small").textContent = "";
    const line = CKB.cartCSV(CKB.readCart(doc, "https://www.cardkingdom.com/sellcart", "sell"), listOf()).split("\n")[1];
    expect(line).toBe("57ffb8ad-d8b4-4764-bbb0-ca4106080a90,Necropotence,Eternal Masters,No,NM,1,,27.00,206649");
  });
});
