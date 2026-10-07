import { test, expect, describe } from "bun:test";
import { CKB, load, cartSubtotal } from "./helpers.js";

const SELL = "https://www.cardkingdom.com/sellcart";
const BUY = "https://www.cardkingdom.com/cart";
const sell = () => load("sell-cart.html");
const buy = () => load("buy-cart.html");
const readSell = (doc) => CKB.readCart(doc, SELL, "sell");
const readBuy = (doc) => CKB.readCart(doc, BUY, "buy");

// plain is a line without its DOM nodes. A failing expect on an object that
// holds one prints the whole window, which bun does not survive.
const plain = ({ productID, lineID, qty, each, total, condition, alt, problem }) => ({
  productID, lineID, qty, each, total, condition, alt, problem,
});

// line is the wrapper of the cart line for a product id.
function line(doc, productID) {
  return doc.querySelector(`.save-for-later-button a[data-ckproductid="${productID}"]`).closest(".cart-item-wrapper");
}

const sum = (lines) => lines.reduce((cents, l) => cents + l.total, 0);

describe("the sell cart", () => {
  test("reads every line, in order", () => {
    const lines = readSell(sell());
    expect(lines.map((l) => l.productID)).toEqual([
      206649, 224590, 50270, 195917, 256544, 307429, 320150, 221214, 256266, 238255,
    ]);
    expect(lines.map((l) => l.qty)).toEqual([1, 1, 3, 1, 4, 1, 1, 2, 1, 1]);
    expect(lines.map((l) => l.each)).toEqual([2700, 10, 90, 1, 600, 100, 5, 2, 25, 9]);
    expect(lines.map((l) => l.total)).toEqual([2700, 10, 270, 1, 2400, 100, 5, 4, 25, 9]);
    expect(lines.map((l) => l.problem).filter(Boolean)).toEqual([]);
  });

  test("every line is near mint", () => {
    expect(new Set(readSell(sell()).map((l) => l.condition))).toEqual(new Set(["NM"]));
  });

  test("the line totals come to the header's subtotal", () => {
    const doc = sell();
    expect(cartSubtotal(doc)).toBe(sum(readSell(doc)));
    expect(cartSubtotal(doc)).toBe(5524);
  });

  test("keeps the card's name as the image gives it", () => {
    // Editions and variations carry colons of their own.
    const alts = readSell(sell()).map((l) => l.alt);
    expect(alts).toContain("Kamigawa: Neon Dynasty: Moon-Circuit Hacker");
    expect(alts).toContain("Mystery Booster/The List: Manor Gate (Commander Legends: Battle for Baldur's Gate)");
    expect(alts).toContain("Promotional Foil: Tajuru Paragon (Prerelease Foil)");
  });

  test("the line id is the quantity form's, and lines do not share one", () => {
    const lines = readSell(sell());
    for (const l of lines) {
      expect(l.wrapper.querySelector(`form[action="/sellcart/lineitem/${l.lineID}"]`)).not.toBeNull();
    }
    expect(new Set(lines.map((l) => l.lineID)).size).toBe(lines.length);
  });

  test("each line knows the box beside its Save for Later", () => {
    for (const l of readSell(sell())) {
      expect(l.host.classList.contains("save-for-later-button")).toBe(true);
      expect(l.wrapper.contains(l.host)).toBe(true);
    }
  });
});

describe("the buy cart", () => {
  test("reads every line, in order, with its condition", () => {
    const lines = readBuy(buy());
    expect(lines.map((l) => l.productID)).toEqual([130810, 217590, 10202, 119725, 239407, 247409]);
    expect(lines.map((l) => l.condition)).toEqual(["NM", "EX", "VG", "G", "NM", "NM"]);
    expect(lines.map((l) => l.qty)).toEqual([1, 1, 2, 1, 3, 1]);
    expect(lines.map((l) => l.each)).toEqual([299, 39, 174, 18, 79, 99]);
    expect(lines.map((l) => l.total)).toEqual([299, 39, 348, 18, 237, 99]);
    expect(lines.map((l) => l.problem).filter(Boolean)).toEqual([]);
  });

  test("the line totals come to the header's subtotal", () => {
    const doc = buy();
    expect(cartSubtotal(doc)).toBe(sum(readBuy(doc)));
    expect(cartSubtotal(doc)).toBe(1040);
  });

  test("a line with no condition is unreadable", () => {
    const doc = buy();
    line(doc, 10202).querySelector(".style").textContent = "Mint";
    expect(plain(readBuy(doc)[2])).toMatchObject({ condition: null, problem: "no condition" });
  });

  test("each cart reads only its own lines", () => {
    expect(readSell(buy()).length).toBe(0);
    expect(readBuy(sell()).length).toBe(0);
  });

  test("an unknown cart is refused", () => {
    expect(() => CKB.readCart(buy(), BUY, "wish")).toThrow("Unknown cart: wish");
  });
});

describe("what is not a line", () => {
  test("the Saved For Later list and both Move All buttons are left alone", () => {
    // The list under the sell cart is the purchase side; its Move All To
    // Cart button carries a product id of its own.
    const doc = sell();
    expect(doc.querySelector('.save-for-later-button a[data-ckproductid="130388"]')).not.toBeNull();
    const ids = readSell(doc).map((l) => l.productID);
    expect(ids).not.toContain(130388);
    expect(ids).not.toContain(281282);
    expect(ids).not.toContain(295868);
  });

  test("a wrapper with only its delete form is not a line", () => {
    const doc = sell();
    line(doc, 206649).querySelector('form[action^="/sellcart/lineitem/"]').remove();
    expect(readSell(doc).map((l) => l.productID)).not.toContain(206649);
  });

  test("a form posting to another site is not a line", () => {
    const doc = sell();
    const form = line(doc, 206649).querySelector('form[action^="/sellcart/lineitem/"]');
    form.setAttribute("action", "https://example.com" + form.getAttribute("action"));
    expect(readSell(doc).map((l) => l.productID)).not.toContain(206649);
  });
});

describe("reading a line", () => {
  test("an absolute form action names the same line", () => {
    const doc = sell();
    const before = readSell(doc)[0].lineID;
    const form = line(doc, 206649).querySelector('form[action^="/sellcart/lineitem/"]');
    form.setAttribute("action", "https://www.cardkingdom.com" + form.getAttribute("action"));
    expect(readSell(doc)[0].lineID).toBe(before);
  });

  test("the quantity is the hidden field's, not the dropdown's", () => {
    // Synthetic: the dropdown shows 7 while the form holds 1.
    const doc = sell();
    line(doc, 206649).querySelector(".dropdown-toggle").textContent = "7 ";
    expect(readSell(doc)[0].qty).toBe(1);
  });

  test("a line with a hundred or more available reads the same way", () => {
    const doc = sell();
    expect(line(doc, 256266).querySelector("input.quantityBox")).not.toBeNull();
    const l = plain(readSell(doc).find((l) => l.productID === 256266));
    expect(l).toMatchObject({ qty: 1, each: 25, total: 25, problem: "" });
  });

  test("a total that is not quantity times price is unreadable", () => {
    // Synthetic: 3 at $0.90 shown as $2.00.
    const doc = sell();
    line(doc, 50270).querySelector(".item-price-wrapper").firstChild.textContent = " $2.00 ";
    expect(readSell(doc).find((l) => l.productID === 50270).problem).toBe("its total is not its quantity times its price");
  });

  test("a buy line's total is read from its own span", () => {
    // Synthetic: 2 at $1.74 shown as $3.50.
    const doc = buy();
    line(doc, 10202).querySelector(".cart-item-price").textContent = " $3.50 ";
    expect(readBuy(doc)[2].problem).toBe("its total is not its quantity times its price");
  });

  test("a price that is not dollars and cents is unreadable", () => {
    const doc = sell();
    line(doc, 206649).querySelector(".item-price-wrapper small").textContent = " $27.000 /ea ";
    expect(readSell(doc)[0].problem).toBe("no price");
  });

  test("a line with no product id is unreadable", () => {
    const doc = sell();
    line(doc, 206649).querySelector(".save-for-later-button a").removeAttribute("data-ckproductid");
    expect(plain(readSell(doc)[0])).toMatchObject({ productID: null, problem: "no product id" });
  });
});
