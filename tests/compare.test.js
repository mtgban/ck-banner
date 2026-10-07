import { test, expect, describe } from "bun:test";
import { CKB, load, text } from "./helpers.js";

const NOW = 1790000000000;

// listWith is the fixture list with some rows edited or dropped; every edit
// is synthetic, and the fixture's own rows match the carts' prices.
function listWith(edits = {}, drop = []) {
  const body = JSON.parse(text("pricelist.json"));
  body.data = body.data
    .filter((r) => !drop.includes(r.id))
    .map((r) => {
      const e = edits[r.id];
      return e ? { ...r, ...e, condition_values: { ...r.condition_values, ...(e.condition_values || {}) } } : r;
    });
  return CKB.reducePrices(body, NOW);
}

const sellLines = () => CKB.readCart(load("sell-cart.html"), "https://www.cardkingdom.com/sellcart", "sell");
const buyLines = () => CKB.readCart(load("buy-cart.html"), "https://www.cardkingdom.com/cart", "buy");

function verdictOf(lines, list, side, id) {
  return CKB.compare(lines.find((l) => l.productID === id), list, side);
}

describe("the sell cart", () => {
  // 206649: 1 at $27.00, wanted.
  test("every line priced as the list is the same", () => {
    const list = listWith();
    expect(sellLines().map((l) => CKB.compare(l, list, "sell").verdict)).toEqual(Array(10).fill("same"));
  });

  test("the list paying more is better", () => {
    expect(verdictOf(sellLines(), listWith({ 206649: { price_buy: "28.50" } }), "sell", 206649)).toEqual({
      verdict: "better",
      price: 2850,
    });
  });

  test("the list paying less is worse", () => {
    expect(verdictOf(sellLines(), listWith({ 206649: { price_buy: "26.99" } }), "sell", 206649)).toEqual({
      verdict: "worse",
      price: 2699,
    });
  });

  test("a card the list wants none of is marked so, even where it pays more", () => {
    const list = listWith({ 206649: { price_buy: "40.00", qty_buying: 0 } });
    expect(verdictOf(sellLines(), list, "sell", 206649).verdict).toBe("wants0");
  });

  test("an id the list does not have is not listed", () => {
    expect(verdictOf(sellLines(), listWith({}, [206649]), "sell", 206649)).toEqual({ verdict: "unlisted" });
  });

  test("an id that names another card is not compared", () => {
    // Synthetic: the row for the line's id is a different card.
    const list = listWith({ 206649: { name: "Dark Ritual", price_buy: "40.00" } });
    expect(verdictOf(sellLines(), list, "sell", 206649)).toEqual({ verdict: "mismatch" });
  });

  test("a line that could not be read is not compared", () => {
    const line = { ...sellLines()[0], problem: "no price" };
    expect(CKB.compare(line, listWith(), "sell")).toEqual({ verdict: "unreadable" });
  });
});

describe("the buy cart", () => {
  // 10202: 2 at $1.74, in VG.
  test("every line priced as the list is the same", () => {
    const list = listWith();
    expect(buyLines().map((l) => CKB.compare(l, list, "buy").verdict)).toEqual(Array(6).fill("same"));
  });

  test("the list asking less for the line's condition is a price drop", () => {
    const list = listWith({ 10202: { condition_values: { vg_price: "1.50" } } });
    expect(verdictOf(buyLines(), list, "buy", 10202)).toEqual({ verdict: "dropped", price: 150 });
  });

  test("the list asking more is higher", () => {
    const list = listWith({ 10202: { condition_values: { vg_price: "1.99" } } });
    expect(verdictOf(buyLines(), list, "buy", 10202)).toEqual({ verdict: "raised", price: 199 });
  });

  test("only the line's own condition counts", () => {
    // A VG line, with every other condition's price moved.
    const list = listWith({ 10202: { price_retail: "0.50", condition_values: { nm_price: "0.50", ex_price: "0.40", g_price: "0.10" } } });
    expect(verdictOf(buyLines(), list, "buy", 10202).verdict).toBe("same");
  });

  test("none in stock in the line's condition is marked so, even where the price dropped", () => {
    const list = listWith({ 10202: { condition_values: { vg_price: "1.00", vg_qty: 0 } } });
    expect(verdictOf(buyLines(), list, "buy", 10202).verdict).toBe("nostock");
  });

  test("an id the list does not have is not listed", () => {
    expect(verdictOf(buyLines(), listWith({}, [10202]), "buy", 10202)).toEqual({ verdict: "unlisted" });
  });
});
