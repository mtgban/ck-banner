import { test, expect, describe, afterEach } from "bun:test";
import { CKB, load, text } from "./helpers.js";

const body = () => JSON.parse(text("pricelist.json"));
const NOW = 1790000000000;

// row is a well-formed list row to break one field of.
function row(changes = {}) {
  return { ...body().data[0], ...changes };
}

const saved = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = saved;
});

describe("money in the list", () => {
  test("reads dollars and cents as the list writes them", () => {
    expect(CKB.listCents("599.99")).toBe(59999);
    expect(CKB.listCents("0.01")).toBe(1);
    expect(CKB.listCents("6.4")).toBe(640);
    expect(CKB.listCents("6")).toBe(600);
  });

  test("refuses more than two decimals or any other shape", () => {
    for (const value of ["1.234", "-1.00", "1,000.00", "$1.00", "1.", ".50", "", " 1.00", 6, null, undefined]) {
      expect(CKB.listCents(value)).toBeNull();
    }
  });
});

describe("reducing the list", () => {
  test("keeps every row, sorted by id, with the list's date", () => {
    const list = CKB.reducePrices(body(), NOW);
    expect(list.ids.length).toBe(19);
    expect([...list.ids]).toEqual(body().data.map((r) => r.id).sort((a, b) => a - b));
    expect(list.skipped).toBe(0);
    expect(list.createdAt).toBe("2026-09-17 04:04:33");
    expect(list.fetchedAt).toBe(NOW);
    expect(list.v).toBe(CKB.LIST_VERSION);
  });

  test("keeps the buy price and quantity the sell cart is compared with", () => {
    const list = CKB.reducePrices(body(), NOW);
    for (const r of body().data) {
      const kept = CKB.lookup(list, r.id);
      expect(kept.buy).toBe(CKB.listCents(r.price_buy));
      expect(kept.wants).toBe(r.qty_buying);
    }
  });

  test("keeps each condition's retail price and stock for the buy cart", () => {
    const list = CKB.reducePrices(body(), NOW);
    const r = body().data.find((r) => r.id === 10202);
    const kept = CKB.lookup(list, 10202);
    for (const c of ["NM", "EX", "VG", "G"]) {
      expect(kept.retail[c]).toBe(CKB.listCents(r.condition_values[c.toLowerCase() + "_price"]));
      expect(kept.stock[c]).toBe(r.condition_values[c.toLowerCase() + "_qty"]);
    }
  });

  test("a row's name key matches its cart line's card", () => {
    // The carts' images name a card exactly as the list's edition, foil,
    // name and variation compose; the key is what checks a line's id.
    const list = CKB.reducePrices(body(), NOW);
    const lines = [
      ...CKB.readCart(load("sell-cart.html"), "https://www.cardkingdom.com/sellcart", "sell"),
      ...CKB.readCart(load("buy-cart.html"), "https://www.cardkingdom.com/cart", "buy"),
    ];
    expect(lines.length).toBe(16);
    for (const l of lines) {
      expect(CKB.lookup(list, l.productID).name).toBe(CKB.cardKey(l.alt, l.foil));
    }
  });

  test("a malformed row is skipped and counted", () => {
    const broken = [
      row({ price_buy: "1.234" }),
      row({ price_buy: 6 }),
      row({ qty_buying: -1 }),
      row({ qty_buying: 1.5 }),
      row({ is_foil: "yes" }),
      row({ id: "5" }),
      row({ id: 0 }),
      row({ variation: null }),
      row({ condition_values: undefined }),
      row({ condition_values: { ...row().condition_values, vg_price: "1,000.00" } }),
    ].map((r, i) => (typeof r.id === "number" && r.id > 0 ? { ...r, id: 900000 + i } : r));
    const list = CKB.reducePrices({ ...body(), data: [...body().data, ...broken] }, NOW);
    expect(list.ids.length).toBe(19);
    expect(list.skipped).toBe(10);
  });

  test("an id listed twice is dropped altogether", () => {
    const twice = { ...body(), data: [...body().data, row({ price_buy: "0.01" })] };
    const list = CKB.reducePrices(twice, NOW);
    expect(CKB.lookup(list, body().data[0].id)).toBeNull();
    expect(list.skipped).toBe(2);
    expect(list.ids.length).toBe(18);
  });

  test("a body that is not the list is refused", () => {
    for (const bad of [null, {}, { data: [] }, { meta: {}, data: [] }, { meta: { created_at: "x" }, data: "rows" }]) {
      expect(() => CKB.reducePrices(bad, NOW)).toThrow(CKB.LIST_UNREADABLE);
    }
    expect(() => CKB.reducePrices({ ...body(), data: [row({ id: 0 })] }, NOW)).toThrow(CKB.LIST_UNREADABLE);
  });

  test("an id not in the list has no row", () => {
    const list = CKB.reducePrices(body(), NOW);
    expect(CKB.lookup(list, 1)).toBeNull();
    expect(CKB.lookup(list, 999999)).toBeNull();
    expect(CKB.lookup(list, list.ids[0]).id).toBe(list.ids[0]);
    expect(CKB.lookup(list, list.ids[18]).id).toBe(list.ids[18]);
  });
});

describe("fetching the list", () => {
  // answer stands in for fetch: it records what it was asked and honours
  // the abort signal the way the browser does.
  function answer(respond) {
    const asked = [];
    globalThis.fetch = (url, options) => {
      asked.push({ url, options });
      return new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        if (respond) {
          respond(resolve, reject);
        }
      });
    };
    return asked;
  }

  const ok = (json) => (resolve) => resolve({ ok: true, status: 200, json: () => Promise.resolve(json) });

  test("asks without cookies or custom headers, so no preflight", async () => {
    const asked = answer(ok(body()));
    const list = await CKB.fetchList();
    expect(asked[0].url).toBe("https://api.cardkingdom.com/api/v2/pricelist");
    expect(asked[0].options.credentials).toBe("omit");
    expect("headers" in asked[0].options).toBe(false);
    expect(asked[0].options.signal).toBeInstanceOf(AbortSignal);
    expect(list.ids.length).toBe(19);
  });

  test("a refusal says what it was", async () => {
    answer((resolve) => resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }));
    await expect(CKB.fetchList()).rejects.toThrow("Card Kingdom's price list answered 503");
    answer((resolve) => resolve({ ok: false, status: 429, json: () => Promise.resolve({}) }));
    await expect(CKB.fetchList()).rejects.toThrow(CKB.LIST_LIMITED);
  });

  test("a peek asks the same way and reads only the list's date", async () => {
    // A body far longer than a peek reads, whose date opens it.
    const text = JSON.stringify(body()) + " ".repeat(1 << 20);
    let pulled = 0;
    const stream = new ReadableStream({
      pull(c) {
        pulled += 1024;
        c.enqueue(new TextEncoder().encode(text.slice(pulled - 1024, pulled)));
        if (pulled >= text.length) {
          c.close();
        }
      },
    });
    const asked = answer((resolve) => resolve(new Response(stream, { status: 200 })));
    expect(await CKB.peekList()).toBe("2026-09-17 04:04:33");
    expect([asked[0].options.credentials, "headers" in asked[0].options]).toEqual(["omit", false]);
    expect(pulled).toBeLessThanOrEqual(8192);
  });

  test("a body that is not JSON is unreadable", async () => {
    answer((resolve) => resolve({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError("bad")) }));
    await expect(CKB.fetchList()).rejects.toThrow(CKB.LIST_UNREADABLE);
  });

  test("Escape aborts the read", async () => {
    answer();
    const escape = new AbortController();
    const reading = CKB.fetchList({ signal: escape.signal });
    escape.abort();
    await expect(reading).rejects.toThrow("aborted");
  });

  test("a read that takes too long says so", async () => {
    answer();
    await expect(CKB.fetchList({ timeout: 20 })).rejects.toThrow(CKB.LIST_TIMED_OUT);
  });
});
