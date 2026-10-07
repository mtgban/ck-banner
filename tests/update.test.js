import { test, expect, describe, afterEach } from "bun:test";
import { CKB, load } from "./helpers.js";

const saved = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = saved;
});

// line is the fixture's first sell line, 1 of 206649 at $27.00.
const line = () => CKB.readCart(load("sell-cart.html"), "https://www.cardkingdom.com/sellcart", "sell")[0];

// cart is an answer shaped as CK's CartResponse, holding item lines.
function cart(...items) {
  return { id: 1, item_count: items.length, has_price_change: false, subtotal: "27.00", lineitems: items };
}

function item(changes = {}) {
  return {
    id: 5550001,
    product_id: 206649,
    style: "NM",
    qty: 1,
    original_quantity: 1,
    price: "28.50",
    original_price: "27.00",
    product: { price_buy: "28.50", max_qty_available: 13 },
    ...changes,
  };
}

// answer stands in for fetch, recording each request.
function answer(respond) {
  const asked = [];
  globalThis.fetch = (url, options) => {
    asked.push({ url: String(url), options });
    return respond(url, options);
  };
  return asked;
}

const ok = (json) => () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(json) });

describe("the request", () => {
  test("is go-mtgban's: one JSON POST to the sell cart, for the line's own quantity", async () => {
    const asked = answer(ok(cart(item())));
    await CKB.updatePrice(line());
    expect(asked.length).toBe(1);
    expect(asked[0].url).toBe("https://www.cardkingdom.com/api/sellcart/add");
    expect(asked[0].options.method).toBe("POST");
    expect(asked[0].options.credentials).toBe("same-origin");
    expect(asked[0].options.headers["Content-Type"]).toBe("application/json");
    expect(asked[0].options.body).toBe('{"product_id":"206649","style":"NM","quantity":1}');
  });

  test("sends the line's quantity, whatever it is", async () => {
    const asked = answer(ok(cart(item({ qty: 3 }))));
    await CKB.updatePrice({ ...line(), qty: 3 });
    expect(JSON.parse(asked[0].options.body).quantity).toBe(3);
  });

  test("carries no token", async () => {
    const asked = answer(ok(cart(item())));
    await CKB.updatePrice(line());
    expect(asked[0].url + asked[0].options.body + JSON.stringify(asked[0].options.headers)).not.toContain("TOKEN");
  });
});

describe("CK's answer decides", () => {
  test("the line at its quantity and the product's buy price is repriced", async () => {
    answer(ok(cart(item())));
    expect(await CKB.updatePrice(line())).toEqual({ outcome: "repriced", lineID: 5550001, qty: 1, price: 2850, buy: 2850 });
  });

  test("the line at its quantity and the old price is kept", async () => {
    answer(ok(cart(item({ price: "27.00" }))));
    expect(await CKB.updatePrice(line())).toMatchObject({ outcome: "kept", price: 2700, buy: 2850 });
  });

  test("another quantity is reported, to be put back", async () => {
    // As if the request added to the line rather than set it.
    answer(ok(cart(item({ qty: 2 }))));
    expect(await CKB.updatePrice(line())).toMatchObject({ outcome: "quantity", qty: 2, lineID: 5550001 });
  });

  test("an answer with no line for the card fails", async () => {
    answer(ok(cart(item({ product_id: 1 }))));
    expect(await CKB.updatePrice(line())).toEqual({ outcome: "failed", message: "Card Kingdom's answer has no line for this card" });
  });

  test("a line of the card in another style is not this line", async () => {
    answer(ok(cart(item({ style: "EX" }))));
    expect((await CKB.updatePrice(line())).outcome).toBe("failed");
  });

  test("an answer holding the card twice fails", async () => {
    answer(ok(cart(item(), item({ id: 5550002 }))));
    expect(await CKB.updatePrice(line())).toEqual({ outcome: "failed", message: "Card Kingdom's answer holds this card twice" });
  });

  test("an answer it cannot read fails", async () => {
    for (const bad of [cart(item({ price: 28.5 })), cart(item({ product: {} })), cart(item({ qty: "1" })), { lineitems: "none" }, null]) {
      answer(ok(bad));
      expect((await CKB.updatePrice(line())).message).toBe("Card Kingdom's answer could not be read");
    }
  });

  test("a refusal, a body that is not JSON, and no answer each fail and say why", async () => {
    answer(() => Promise.resolve({ ok: false, status: 419, json: () => Promise.resolve({}) }));
    expect(await CKB.updatePrice(line())).toEqual({ outcome: "failed", message: "Card Kingdom answered 419" });
    answer(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError("x")) }));
    expect((await CKB.updatePrice(line())).message).toBe("Card Kingdom's answer could not be read");
    answer(() => Promise.reject(new TypeError("Failed to fetch")));
    expect((await CKB.updatePrice(line())).message).toBe("The request did not reach Card Kingdom");
  });
});

describe("putting a quantity back", () => {
  test("posts the line's own form: an absolute quantity and its token, to the line CK holds", async () => {
    const asked = answer(() => Promise.resolve({ ok: true, status: 200 }));
    globalThis.location = new URL("https://www.cardkingdom.com/sellcart");
    expect(await CKB.restoreQuantity(line(), 5550001, 1)).toBe(true);
    delete globalThis.location;
    expect(asked[0].url).toBe("https://www.cardkingdom.com/sellcart/lineitem/5550001");
    expect(asked[0].options.method).toBe("POST");
    expect(asked[0].options.body.toString()).toBe("_token=TOKEN&qty=1");
  });
});
