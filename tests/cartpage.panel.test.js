import { test, expect, describe } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { CKB, docOf, text } from "./helpers.js";
import { mountCart, pricelist } from "./panel.js";

const SELL_IDS = [206649, 224590, 50270, 195917, 256544, 307429, 320150, 221214, 256266, 238255];

// A list in which, against the sell cart (all edits synthetic):
// 206649 pays more, 224590 pays less, 50270 is wanted by none, 195917 is
// gone from the list, 256544's id names another card; the rest match.
const moved = () =>
  pricelist(
    {
      206649: { price_buy: "28.50" },
      224590: { price_buy: "0.05" },
      50270: { qty_buying: 0 },
      256544: { name: "Dark Ritual" },
    },
    [195917]
  );

describe("the panel", () => {
  test("appears on the sell cart and the buy cart", async () => {
    expect((await mountCart()).heading()).toBe("CK BANner");
    expect((await mountCart({ side: "buy" })).heading()).toBe("CK BANner");
  });

  test("offers to check, and says what checking does", async () => {
    const it = await mountCart();
    expect(it.button().textContent).toBe("Load prices");
    expect(it.tip()).toBe("Compare this cart with Card Kingdom's price list, read once and kept for an hour");
    expect(it.marks()).toEqual([]);
    expect(it.asked).toEqual([]);
  });

  test("stays off the carts' form targets", async () => {
    expect((await mountCart({ path: "/sellcart/lineitem/1001" })).panel).toBeNull();
    expect((await mountCart({ side: "buy", path: "/cart/lineitem/1001/delete" })).panel).toBeNull();
  });

  test("stays hidden on a cart with no lines", async () => {
    expect((await mountCart({ body: "<p>Your cart is empty.</p>" })).panel.hidden).toBe(true);
  });
});

describe("the cart's CSV", () => {
  test("is greyed out until a list is in hand, then saves the sell cart", async () => {
    const it = await mountCart();
    expect(it.csv().disabled).toBe(true);
    it.csv().click();
    await it.idle();
    expect([it.asked.length, it.saved().length]).toEqual([0, 0]);
    it.button().click();
    await it.idle();
    expect(it.csv().disabled).toBe(false);
    it.csv().click();
    const file = await it.file();
    expect(file.name).toBe("ck-sell-cart.csv");
    expect(file.text.split("\n").slice(0, 2)).toEqual([
      "Scryfall ID,Name,Edition,Foil,Condition,Quantity,Price,Total,CK ID",
      "57ffb8ad-d8b4-4764-bbb0-ca4106080a90,Necropotence,Eternal Masters,No,NM,1,27.00,27.00,206649",
    ]);
    expect(it.asked.length).toBe(1);
  });

  test("is ready on load with a kept list", async () => {
    const it = await mountCart({ kept: CKB.reducePrices(pricelist(), Date.now()) });
    expect(it.csv().disabled).toBe(false);
    it.csv().click();
    expect((await it.file()).text.split("\n")[1].startsWith("57ffb8ad-d8b4-4764-bbb0-ca4106080a90,")).toBe(true);
    // The page's one request is its peek at the list's date.
    await it.idle();
    expect(it.asked.length).toBe(1);
  });

  test("stays greyed when the list cannot be read", async () => {
    const it = await mountCart({ respond: (resolve) => resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }) });
    it.button().click();
    await it.idle();
    expect(it.failed()).toBe(true);
    expect(it.csv().disabled).toBe(true);
  });

  test("saves the buy cart under its own name", async () => {
    const it = await mountCart({ side: "buy" });
    it.button().click();
    await it.idle();
    it.csv().click();
    expect((await it.file()).name).toBe("ck-buy-cart.csv");
  });
});

describe("checking prices on the sell cart", () => {
  test("reads the list once, without cookies or headers", async () => {
    const it = await mountCart();
    it.button().click();
    expect(it.busy()).toBe(true);
    expect(it.word()).toBe("fetching API");
    expect(it.button().disabled).toBe(true);
    await it.idle();
    expect(it.asked.length).toBe(1);
    expect(it.asked[0].url).toBe("https://api.cardkingdom.com/api/v2/pricelist");
    expect(it.asked[0].options.credentials).toBe("omit");
    expect("headers" in it.asked[0].options).toBe(false);
  });

  test("a cart the list agrees with gets no marks, and the panel just its tick", async () => {
    const it = await mountCart();
    it.button().click();
    await it.idle();
    expect(it.marks()).toEqual([]);
    expect(it.heading()).toBe("CK BANner - ready\u2713");
    expect(it.tip()).toBe("10 prices are the same\nPrice list of 2026-09-17 04:04");
    expect(it.button().textContent).toBe("Refresh");
  });

  test("marks every line beside its Save for Later, never inside the link", async () => {
    const it = await mountCart({ prices: moved() });
    it.button().click();
    await it.idle();
    const marks = it.marks();
    expect(marks.map((m) => m.product)).toEqual([206649, 224590, 50270, 195917, 256544]);
    expect(marks.every((m) => m.first && !m.inLink)).toBe(true);
  });

  test("each verdict reads as the spec says", async () => {
    const it = await mountCart({ prices: moved() });
    it.button().click();
    await it.idle();
    expect(it.mark(206649)).toMatchObject({ verdict: "better", badge: "Update price" });
    expect(it.mark(206649).tip).toBe("Buylist currently pays $28.50.");
    expect(it.mark(224590)).toMatchObject({ verdict: "worse", badge: "Keep price", tone: "warn" });
    expect(it.mark(224590).tip).toBe("Buylist currently pays $0.05.");
    expect(it.mark(50270)).toMatchObject({ verdict: "wants0", badge: "Wants 0", tone: "warn" });
    expect(it.mark(50270).tip).toBe("List wants none, at $0.90.");
    expect(it.mark(195917)).toMatchObject({ verdict: "unlisted", badge: "?", tone: "quiet" });
    expect(it.mark(195917).tip).toBe("Not in the price list.");
    expect(it.mark(256544)).toMatchObject({ verdict: "mismatch", badge: "?" });
    expect(it.mark(256544).tip).toBe("Could not match this card to the price list (id 256544).");
    // A line the list agrees with is left unmarked.
    expect(it.mark(307429)).toBeUndefined();
  });

  test("the panel counts the lines and says when the list is from", async () => {
    const it = await mountCart({ prices: moved() });
    it.button().click();
    await it.idle();
    expect(it.heading()).toBe("CK BANner - 1 better\u2713");
    expect(it.tip()).toBe("1 price is better, 1 worse, 1 not wanted, 5 the same, 1 not listed, 1 not matching\nPrice list of 2026-09-17 04:04");
  });

  test("the list's unreadable rows are counted", async () => {
    // Synthetic: one row's price is not a price.
    const it = await mountCart({ prices: pricelist({ 206649: { price_buy: "28.5x" } }) });
    it.button().click();
    await it.idle();
    expect(it.tip()).toBe("9 prices are the same, 1 not listed\nPrice list of 2026-09-17 04:04 (1 row unreadable)");
  });

  test("a line the page could not read is marked, not dropped", async () => {
    // Synthetic: one line's price each loses its cents.
    const it = await mountCart({
      body: (await import("./helpers.js")).text("sell-cart.html").replace("$27.00 /ea", "$27 /ea"),
    });
    it.button().click();
    await it.idle();
    expect(it.mark(206649)).toMatchObject({ verdict: "unreadable", badge: "?" });
    expect(it.mark(206649).tip).toBe("Could not read this line: no price.");
  });

  test("carries no title and nothing under its button", async () => {
    const it = await mountCart();
    it.button().click();
    await it.idle();
    expect(it.titled()).toBe(0);
    expect(it.below()).toBe(0);
  });
});

describe("checking prices on the buy cart", () => {
  test("marks a price drop for the line's condition", async () => {
    // Synthetic: 10202 (2 at $1.74 in VG) now $1.50 in VG; 130810 (NM) now
    // higher; 217590 (EX) out of stock in EX.
    const it = await mountCart({
      side: "buy",
      prices: pricelist({
        10202: { condition_values: { vg_price: "1.50" } },
        130810: { condition_values: { nm_price: "3.49" } },
        217590: { condition_values: { ex_qty: 0 } },
      }),
    });
    it.button().click();
    await it.idle();
    expect(it.mark(10202)).toMatchObject({ verdict: "dropped", badge: "Price dropped", tone: "good" });
    expect(it.mark(10202).tip).toBe("List asks $1.50 in VG, cart has $1.74 (-$0.24 each).");
    expect(it.mark(130810)).toMatchObject({ verdict: "raised", badge: "Price went up", tone: "warn" });
    expect(it.mark(217590)).toMatchObject({ verdict: "nostock", badge: "None in stock" });
    expect(it.heading()).toBe("CK BANner - 1 better\u2713");
    expect(it.tip()).toBe("1 price is better, 1 worse, 1 out of stock, 3 the same\nPrice list of 2026-09-17 04:04");
  });
});

describe("the hour", () => {
  test("a fresh kept list marks the cart on load, then only peeks at the list's date", async () => {
    const it = await mountCart({ kept: CKB.reducePrices(moved(), Date.now()) });
    expect(it.mark(206649).verdict).toBe("better");
    expect(it.button().textContent).toBe("Refresh");
    await it.idle();
    expect(it.asked.length).toBe(1);
    expect(it.button().disabled).toBe(true);
    expect(it.tip().endsWith("Price list of 2026-09-17 04:04")).toBe(true);
  });

  test("a page opened again soon after a check does not check again", async () => {
    const idb = new IDBFactory();
    const first = await mountCart({ idb, kept: CKB.reducePrices(moved(), Date.now()) });
    await first.idle();
    expect(first.asked.length).toBe(1);
    const next = await mountCart({ idb });
    await next.idle();
    expect(next.asked).toEqual([]);
  });

  test("a kept list CK has a newer one of brings Refresh back, and says so", async () => {
    const newer = moved();
    newer.meta.created_at = "2026-09-17 05:04:00";
    const it = await mountCart({ kept: CKB.reducePrices(moved(), Date.now()), prices: newer });
    await it.idle();
    expect(it.button().disabled).toBe(false);
    expect(it.tip().endsWith("Price list of 2026-09-17 04:04; a newer one is out")).toBe(true);
  });

  test("a page shown again after the computer slept through the hour brings Refresh back", async () => {
    const it = await mountCart({ kept: CKB.reducePrices(moved(), Date.now()) });
    await it.idle();
    expect(it.button().disabled).toBe(true);
    it.later(CKB.LIST_TTL);
    it.shown(true);
    await it.idle();
    expect(it.button().disabled).toBe(false);
    // Over the hour, Refresh is back without asking CK anything.
    expect(it.asked.length).toBe(1);
  });

  test("a page shown again a while after CK last said asks again", async () => {
    const newer = moved();
    newer.meta.created_at = "2026-09-17 05:04:00";
    const served = [moved(), newer];
    const it = await mountCart({
      kept: CKB.reducePrices(moved(), Date.now()),
      respond: (resolve) => resolve(new Response(JSON.stringify(served.shift()), { status: 200 })),
    });
    await it.idle();
    expect(it.asked.length).toBe(1);
    expect(it.button().disabled).toBe(true);
    it.later(it.window.CKB.CHECK_GAP);
    it.shown(false);
    await it.idle();
    expect(it.asked.length).toBe(1);
    it.shown(true);
    await it.idle();
    expect(it.asked.length).toBe(2);
    expect(it.button().disabled).toBe(false);
    expect(it.tip().endsWith("Price list of 2026-09-17 04:04; a newer one is out")).toBe(true);
  });

  test("a page opened in the background and shown while it asks does not ask twice", async () => {
    const answers = [];
    const it = await mountCart({ kept: CKB.reducePrices(moved(), Date.now()), respond: (resolve) => answers.push(resolve) });
    it.shown(true);
    await it.idle();
    expect(it.asked.length).toBe(1);
    answers[0](new Response(JSON.stringify(moved()), { status: 200 }));
    await it.idle();
    expect(it.asked.length).toBe(1);
    expect(it.button().disabled).toBe(true);
  });

  test("a page shown again soon after a check does not ask again", async () => {
    const it = await mountCart({ kept: CKB.reducePrices(moved(), Date.now()) });
    await it.idle();
    it.shown(true);
    await it.idle();
    expect(it.asked.length).toBe(1);
    expect(it.button().disabled).toBe(true);
  });

  test("a stale kept list marks nothing and asks for nothing", async () => {
    const it = await mountCart({ kept: CKB.reducePrices(moved(), Date.now() - CKB.LIST_TTL) });
    expect(it.asked).toEqual([]);
    expect(it.marks()).toEqual([]);
    expect(it.button().textContent).toBe("Load prices");
  });

  test("a list read on one cart is kept for the next", async () => {
    const first = await mountCart();
    first.button().click();
    await first.idle();
    expect(await first.kept()).not.toBeNull();
    const next = await mountCart({ side: "buy", idb: first.idb });
    await next.idle();
    // Read moments ago, it is not checked with CK again.
    expect(next.asked).toEqual([]);
    expect(next.heading()).toBe("CK BANner - ready\u2713");
    expect(next.button().textContent).toBe("Refresh");
  });
});

describe("stopping and failing", () => {
  test("Escape stops the read, keeps nothing and marks nothing", async () => {
    const it = await mountCart({ respond: () => {} });
    it.button().click();
    await it.settle();
    expect(it.busy()).toBe(true);
    expect(it.leaving()).toBe(true);
    it.escape();
    await it.settle();
    expect(it.busy()).toBe(false);
    expect(it.leaving()).toBe(false);
    expect(it.marks()).toEqual([]);
    expect(it.heading()).toBe("CK BANner");
    expect(await it.kept()).toBeNull();
  });

  test("a list that arrives after Escape is not used or kept", async () => {
    // The response is in and its body is still arriving when Escape lands,
    // in a browser that does not abort the body with the request.
    let release;
    const body = new Promise((resolve) => (release = resolve));
    const it = await mountCart({ respond: (resolve) => resolve({ ok: true, status: 200, json: () => body }) });
    it.button().click();
    await it.settle();
    it.escape();
    release(moved());
    await it.settle();
    expect(it.marks()).toEqual([]);
    expect(it.heading()).toBe("CK BANner");
    expect(await it.kept()).toBeNull();
  });

  test("a refused read says why and marks nothing", async () => {
    const it = await mountCart({ respond: (resolve) => resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }) });
    it.button().click();
    await it.idle();
    expect(it.failed()).toBe(true);
    expect(it.tip()).toBe("Card Kingdom's price list answered 503");
    expect(it.marks()).toEqual([]);
    expect(it.button().disabled).toBe(false);
  });

  test("Refresh is greyed out while the list is fresh, and comes back as it ages", async () => {
    // Kept, and fresh, until a moment after the page marked the cart.
    const it = await mountCart({ kept: CKB.reducePrices(moved(), Date.now() - CKB.LIST_TTL + 150) });
    expect(it.button().textContent).toBe("Refresh");
    expect(it.button().disabled).toBe(true);
    await it.settle(250);
    expect(it.button().disabled).toBe(false);
  });

  test("a refused refresh keeps the marks it had", async () => {
    const it = await mountCart({
      kept: CKB.reducePrices(moved(), Date.now() - CKB.LIST_TTL + 150),
      respond: (resolve) => resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }),
    });
    await it.settle(250);
    it.button().click();
    await it.idle();
    expect(it.failed()).toBe(true);
    expect(it.mark(206649).verdict).toBe("better");
    expect(it.heading()).toBe("CK BANner - 1 better\u2717");
  });
});

describe("a page that redraws itself", () => {
  test("a line the page redrew is marked again, once", async () => {
    const it = await mountCart({ prices: moved() });
    it.button().click();
    await it.idle();
    it.redraw(224590);
    expect(it.mark(224590)).toBeUndefined();
    await it.settle(400);
    expect(it.marks().filter((m) => m.product === 224590).length).toBe(1);
    expect(it.marks().length).toBe(5);
  });

  test("its own marks, and the lines it leaves unmarked, do not make it mark again", async () => {
    const it = await mountCart({ prices: moved() });
    it.button().click();
    await it.idle();
    const first = it.panel.ownerDocument.querySelector(".ck-banner-line");
    await it.settle(400);
    // Still the same element: nothing marked the cart again.
    expect(first.isConnected).toBe(true);
    expect(it.marks().length).toBe(5);
  });
});

describe("Update price", () => {
  // CK's answer, shaped as its CartResponse, for line 206649 (1 at $27.00).
  const answer = (changes = {}) => ({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        lineitems: [
          { id: 5550001, product_id: 206649, style: "NM", qty: 1, price: "28.50", product: { price_buy: "28.50" }, ...changes },
        ],
      }),
  });

  // Two lines the list now pays more for: 206649 and 224590.
  const two = () => pricelist({ 206649: { price_buy: "28.50" }, 224590: { price_buy: "0.20" } });

  async function marked(options) {
    const it = await mountCart({ prices: moved(), ...options });
    it.button().click();
    await it.idle();
    return it;
  }

  test("a better sell line offers it, beside Save for Later", async () => {
    const it = await marked();
    expect(it.update(206649).textContent).toBe("Update price");
    expect(it.update(206649).classList.contains("btn")).toBe(true);
    expect(it.mark(206649)).toMatchObject({ verdict: "better", first: true, inLink: false });
    expect(it.updates().length).toBe(1);
  });

  test("the buy cart offers none, even for a drop", async () => {
    const it = await mountCart({ side: "buy", prices: pricelist({ 10202: { condition_values: { vg_price: "1.50" } } }) });
    it.button().click();
    await it.idle();
    expect(it.mark(10202).verdict).toBe("dropped");
    expect(it.updates()).toEqual([]);
  });

  test("one click sends one request, for the line's quantity, then reloads", async () => {
    const it = await marked({ writes: () => Promise.resolve(answer()) });
    it.update(206649).click();
    await it.idle();
    expect(it.written).toEqual([
      { url: "https://www.cardkingdom.com/api/sellcart/add", method: "POST", body: '{"product_id":"206649","style":"NM","quantity":1}' },
    ]);
    // Updating, with nothing to press, until the reload shows CK's own figures.
    expect(it.update(206649).textContent).toBe("Updating");
    expect(it.update(206649).disabled).toBe(true);
    expect(it.button().disabled).toBe(true);
    expect(it.reloads.length).toBe(1);
    expect(it.leaving()).toBe(false);
  });

  test("only one update runs at a time, and the page is held while it does", async () => {
    let release;
    const it = await mountCart({ prices: two(), writes: () => new Promise((resolve) => (release = resolve)) });
    it.button().click();
    await it.settle();
    expect(it.updates().length).toBe(2);
    it.update(206649).click();
    await it.settle();
    expect(it.updates().every((b) => b.disabled)).toBe(true);
    expect(it.button().disabled).toBe(true);
    expect(it.leaving()).toBe(true);
    it.update(224590).click();
    it.escape();
    await it.settle();
    expect(it.written.length).toBe(1);
    release(answer({ price: "27.00" }));
    await it.settle();
    // Escape did not stop it: CK's answer was read.
    expect(it.mark(206649).badge).toBe("Price kept");
  });

  test("a second update waits for the first even if its button is enabled again", async () => {
    // Synthetic: something on the page re-enables a button mid-write.
    const it = await mountCart({ prices: two(), writes: () => new Promise(() => {}) });
    it.button().click();
    await it.settle();
    it.update(206649).click();
    await it.settle();
    it.update(224590).disabled = false;
    it.update(224590).click();
    await it.settle();
    expect(it.written.length).toBe(1);
  });

  test("CK keeping the old price is said, and nothing more is sent", async () => {
    const it = await mountCart({ prices: two(), writes: () => Promise.resolve(answer({ price: "27.00" })) });
    it.button().click();
    await it.idle();
    it.update(206649).click();
    await it.idle();
    expect(it.mark(206649)).toMatchObject({ badge: "Price kept", tone: "warn" });
    expect(it.mark(206649).tip).toBe("Card Kingdom kept $27.00 each. Remove the card and add it again to take $28.50 each.");
    expect(it.written.length).toBe(1);
    expect(it.reloads).toEqual([]);
    expect(it.update(224590).disabled).toBe(false);
    expect(it.heading()).toBe("CK BANner - 2 better✓");
  });

  test("another quantity is put back through the line's own form, then the page reloads", async () => {
    const it = await marked({
      writes: (url) => Promise.resolve(url.endsWith("/api/sellcart/add") ? answer({ qty: 2 }) : { ok: true, status: 200 }),
    });
    it.update(206649).click();
    await it.idle();
    expect(it.written).toEqual([
      { url: "https://www.cardkingdom.com/api/sellcart/add", method: "POST", body: '{"product_id":"206649","style":"NM","quantity":1}' },
      { url: "https://www.cardkingdom.com/sellcart/lineitem/5550001", method: "POST", body: "_token=TOKEN&qty=1" },
    ]);
    expect(it.update(206649).textContent).toBe("Updating");
    expect(it.button().disabled).toBe(true);
    expect(it.reloads.length).toBe(1);
    expect(it.leaving()).toBe(false);
  });

  test("a quantity that cannot be put back is said, and locks every other update", async () => {
    const it = await mountCart({
      prices: two(),
      writes: (url) => Promise.resolve(url.endsWith("/api/sellcart/add") ? answer({ qty: 2 }) : { ok: false, status: 419 }),
    });
    it.button().click();
    await it.idle();
    it.update(206649).click();
    await it.idle();
    expect(it.written.length).toBe(2);
    expect(it.mark(206649)).toMatchObject({ badge: "Not updated", tone: "bad" });
    expect(it.mark(206649).tip).toBe(
      "Card Kingdom set this line to 2, and putting back 1 failed. Reload the page to see what Card Kingdom holds."
    );
    expect(it.failed()).toBe(true);
    expect(it.update(224590).disabled).toBe(true);
    expect(it.reloads).toEqual([]);
  });

  test("a failed update locks every other until the page is reloaded", async () => {
    const it = await mountCart({ prices: two(), writes: () => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }) });
    it.button().click();
    await it.idle();
    it.update(206649).click();
    await it.idle();
    expect(it.mark(206649)).toMatchObject({ badge: "Not updated", tone: "bad" });
    expect(it.mark(206649).tip).toBe("Card Kingdom answered 503. Reload the page to see what Card Kingdom holds.");
    expect(it.failed()).toBe(true);
    expect(it.update(224590).disabled).toBe(true);
    it.update(224590).click();
    await it.idle();
    expect(it.written.length).toBe(1);
    expect(it.reloads).toEqual([]);
    it.shown(true);
    await it.idle();
    expect(it.failed()).toBe(true);
  });

  test("a list that went stale since it was read sends nothing", async () => {
    // Kept, and fresh, until a moment after the page marked the cart.
    const it = await mountCart({ kept: CKB.reducePrices(moved(), Date.now() - CKB.LIST_TTL + 150) });
    expect(it.update(206649)).not.toBeNull();
    await it.settle(250);
    it.update(206649).click();
    await it.idle();
    expect(it.written).toEqual([]);
    expect(it.mark(206649)).toMatchObject({ badge: "Check again", tone: "warn" });
    expect(it.mark(206649).tip).toBe("The price list is over an hour old; check prices again before updating.");
  });

  test("a line that changed since it was marked sends nothing", async () => {
    const it = await marked({ writes: () => Promise.resolve(answer()) });
    // Synthetic: the page now shows the line at the list's price.
    const wrapper = it.window.document.querySelector('.save-for-later-button a[data-ckproductid="206649"]').closest(".cart-item-wrapper");
    wrapper.querySelector(".item-price-wrapper").firstChild.textContent = " $28.50 ";
    wrapper.querySelector(".item-price-wrapper small").textContent = " $28.50 /ea ";
    it.update(206649).click();
    await it.idle();
    expect(it.written).toEqual([]);
    expect(it.mark(206649).tip).toBe("This line changed since it was marked; check prices again.");
  });

  test("nothing it sends is ever a delete", async () => {
    const it = await marked({ writes: (url) => Promise.resolve(url.endsWith("/add") ? answer({ qty: 3 }) : { ok: true, status: 200 }) });
    it.update(206649).click();
    await it.idle();
    expect(it.written.length).toBe(2);
    expect(it.written.every((w) => w.method === "POST" && !/delete|empty|remove/i.test(w.url + w.body))).toBe(true);
  });
});

describe("the count", () => {
  const two = () => pricelist({ 206649: { price_buy: "28.50" }, 224590: { price_buy: "0.20" } });

  test("takes the page to each better line in turn, and round again", async () => {
    const it = await mountCart({ prices: two() });
    it.button().click();
    await it.idle();
    // Plain fields only: a failing expect on a node prints the whole window.
    const at = () => [it.focused().className, it.focused().closest(".ck-banner-line")?.getAttribute("data-product")];
    expect(it.label().getAttribute("role")).toBe("button");
    it.label().click();
    expect(at()).toEqual(["btn ck-banner-update", "206649"]);
    it.label().dispatchEvent(new it.window.KeyboardEvent("keydown", { key: "Enter" }));
    expect(at()).toEqual(["btn ck-banner-update", "224590"]);
    it.label().click();
    expect(at()).toEqual(["btn ck-banner-update", "206649"]);
  });

  test("is plain text when no line is better", async () => {
    const it = await mountCart();
    it.button().click();
    await it.idle();
    expect(it.label().hasAttribute("role")).toBe(false);
    it.label().click();
    expect(!!it.focused().closest(".ck-banner-line")).toBe(false);
  });
});

describe("Update all", () => {
  const two = () => pricelist({ 206649: { price_buy: "28.50" }, 224590: { price_buy: "0.20" } });

  // CK answers for the two better lines, each at the list's price, with
  // changes[product] edited in.
  const LINES = { 206649: { id: 5550001, price: "28.50" }, 224590: { id: 5550002, price: "0.20" } };
  const answer = (product, changes = {}) => {
    const line = LINES[product];
    const item = { id: line.id, product_id: product, style: "NM", qty: 1, price: line.price, product: { price_buy: line.price }, ...changes };
    return { ok: true, status: 200, json: () => Promise.resolve({ lineitems: [item] }) };
  };
  const ck = (changes = {}) => (url, options) => {
    const product = Number(JSON.parse(options.body).product_id);
    return Promise.resolve(answer(product, changes[product]));
  };

  async function marked(options) {
    const it = await mountCart({ prices: two(), ...options });
    it.button().click();
    await it.idle();
    return it;
  }

  test("sits under Empty Cart, counting the lines it will update", async () => {
    const it = await marked();
    expect(!!it.all().previousElementSibling.querySelector('form[action$="/sellcart/empty_cart"]')).toBe(true);
    expect(it.all().querySelector("button").className).toBe("btn btn-default ck-banner-update-all");
    expect(it.all().textContent).toBe("Update 2 prices");
  });

  test("is greyed out, saying why, when no line is better", async () => {
    const it = await mountCart();
    expect(!!it.all()).toBe(false);
    it.button().click();
    await it.idle();
    const control = it.all().querySelector("button");
    expect([control.textContent, control.className, control.getAttribute("aria-disabled")]).toEqual([
      "Update prices",
      "btn btn-default ck-banner-update-all disabled",
      "true",
    ]);
    expect(it.all().querySelector("#" + control.getAttribute("aria-describedby")).textContent).toBe(
      "All the best prices are already in the cart."
    );
    control.click();
    await it.idle();
    expect(it.written).toEqual([]);
    expect(it.busy()).toBe(false);
  });

  test("is not offered on the buy cart", async () => {
    const buy = await mountCart({ side: "buy", prices: pricelist({ 10202: { condition_values: { vg_price: "1.50" } } }) });
    buy.button().click();
    await buy.idle();
    expect(!!buy.all()).toBe(false);
  });

  test("updates every better line, top to bottom, then reloads", async () => {
    const it = await marked({ writes: ck() });
    it.all().querySelector("button").click();
    await it.idle();
    expect(it.written.map((w) => JSON.parse(w.body).product_id)).toEqual(["206649", "224590"]);
    expect(it.mark(206649)).toMatchObject({ badge: "Updated", tone: "good" });
    expect(it.mark(224590).tip).toBe("Card Kingdom now pays $0.20 each.");
    expect(it.reloads.length).toBe(1);
    expect(it.button().disabled).toBe(true);
    expect(it.leaving()).toBe(false);
  });

  test("sends one request at a time, and holds the page while it runs", async () => {
    let release;
    const answers = ck();
    const it = await marked({ writes: (url, options) => (release ? answers(url, options) : new Promise((r) => (release = () => r(answers(url, options))))) });
    it.all().querySelector("button").click();
    await it.settle();
    expect(it.written.length).toBe(1);
    expect(it.word()).toBe("updating 1 of 2");
    expect(it.update(224590).disabled).toBe(true);
    expect(it.leaving()).toBe(true);
    release();
    await it.idle();
    expect(it.written.length).toBe(2);
  });

  test("waits between requests, as a walk does", async () => {
    const it = await marked({ writes: ck() });
    it.window.CKB.PACE = 300;
    it.all().querySelector("button").click();
    await it.settle(150);
    expect(it.written.length).toBe(1);
    await it.settle(400);
    expect(it.written.length).toBe(2);
  });

  test("stops at the first refusal and locks every update", async () => {
    const it = await marked({ writes: () => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }) });
    it.all().querySelector("button").click();
    await it.idle();
    expect(it.written.length).toBe(1);
    expect(it.mark(206649)).toMatchObject({ badge: "Not updated", tone: "bad" });
    expect(it.failed()).toBe(true);
    expect(it.update(224590).disabled).toBe(true);
    expect(it.all().querySelector("button").disabled).toBe(true);
    expect(it.reloads).toEqual([]);
  });

  test("stops at a quantity it cannot put back", async () => {
    const it = await marked({
      writes: (url, options) => (url.endsWith("/api/sellcart/add") ? ck({ 206649: { qty: 2 } })(url, options) : Promise.resolve({ ok: false, status: 419 })),
    });
    it.all().querySelector("button").click();
    await it.idle();
    expect(it.written.length).toBe(2);
    expect(it.mark(206649)).toMatchObject({ badge: "Not updated", tone: "bad" });
    expect(it.mark(206649).tip).toBe(
      "Card Kingdom set this line to 2, and putting back 1 failed. Reload the page to see what Card Kingdom holds."
    );
    expect(it.update(224590).disabled).toBe(true);
    expect(it.reloads).toEqual([]);
  });

  test("Escape stops it once the request in flight is answered", async () => {
    let release;
    const it = await marked({ writes: (url, options) => new Promise((r) => (release = () => r(ck()(url, options)))) });
    it.all().querySelector("button").click();
    await it.settle();
    it.escape();
    release();
    await it.idle();
    expect(it.written.length).toBe(1);
    expect(it.mark(206649).badge).toBe("Updated");
    expect(it.reloads.length).toBe(1);
  });

  test("sends nothing once the list has gone stale", async () => {
    // Kept, and fresh, until a moment after the page marked the cart.
    const it = await mountCart({ kept: CKB.reducePrices(two(), Date.now() - CKB.LIST_TTL + 150), writes: ck() });
    await it.settle(250);
    it.all().querySelector("button").click();
    await it.settle();
    expect(it.written).toEqual([]);
    expect(it.failed()).toBe(true);
    expect(it.tip()).toBe("The price list is over an hour old; load prices again before updating.");
  });

  test("prices CK kept leave the page as it is", async () => {
    const it = await marked({ writes: ck({ 206649: { price: "27.00" }, 224590: { price: "0.10" } }) });
    it.all().querySelector("button").click();
    await it.idle();
    expect(it.written.length).toBe(2);
    expect(it.marks().filter((m) => m.badge === "Price kept").length).toBe(2);
    expect(it.reloads).toEqual([]);
    expect(it.busy()).toBe(false);
    expect(it.all().querySelector("button").textContent).toBe("Update prices");
  });
});

describe("a signed-out cart", () => {
  // The sell cart as a visitor who is not signed in sees it: no Save for
  // Later anywhere, so no line carries its product id.
  function signedOut() {
    const doc = docOf(text("sell-cart.html"));
    doc.querySelectorAll(".save-for-later-button").forEach((box) => box.remove());
    return doc.body.innerHTML;
  }

  test("is marked by each line's card, in boxes of its own", async () => {
    const it = await mountCart({ body: signedOut(), prices: moved() });
    it.button().click();
    await it.idle();
    expect(it.mark(206649)).toMatchObject({ verdict: "better", badge: "Update price", first: true });
    expect(it.mark(224590)).toMatchObject({ verdict: "worse", badge: "Keep price" });
    expect(it.mark(50270).verdict).toBe("wants0");
    expect(it.window.document.querySelectorAll(".cart-item-details > .ck-banner-own").length).toBe(it.marks().length);
  });

  test("Update price sends the product id the line's card has", async () => {
    const answer = {
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          lineitems: [{ id: 5550001, product_id: 206649, style: "NM", qty: 1, price: "28.50", product: { price_buy: "28.50" } }],
        }),
    };
    const it = await mountCart({ body: signedOut(), prices: moved(), writes: () => Promise.resolve(answer) });
    it.button().click();
    await it.idle();
    it.update(206649).click();
    await it.idle();
    expect(it.written.map((w) => w.body)).toEqual(['{"product_id":"206649","style":"NM","quantity":1}']);
    expect(it.reloads.length).toBe(1);
  });

  test("a signed-out line the page redrew is marked again", async () => {
    const it = await mountCart({ body: signedOut(), prices: moved() });
    it.button().click();
    await it.idle();
    // Synthetic: the page redraws the line's details, taking the box along.
    it.window.document.querySelector('.ck-banner-line[data-product="224590"]').closest(".ck-banner-own").remove();
    await it.settle(400);
    expect(it.mark(224590).badge).toBe("Keep price");
  });
});

describe("a price list out of date", () => {
  // CK's answer for line 206649 (1 at $27.00), at price each and buy.
  const answer = (price, buy) => ({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        lineitems: [{ id: 5550001, product_id: 206649, style: "NM", qty: 1, price, product: { price_buy: buy } }],
      }),
  });
  // A list that pays $28.50 for 206649 and $0.20 for 224590 (cart: $0.10).
  const listed = () => pricelist({ 206649: { price_buy: "28.50" }, 224590: { price_buy: "0.20" } });

  async function marked(options) {
    const it = await mountCart({ prices: listed(), ...options });
    it.button().click();
    await it.idle();
    return it;
  }

  test("a line already at CK's price is said to be current, with no reload", async () => {
    const it = await marked({ writes: () => Promise.resolve(answer("27.00", "27.00")) });
    it.update(206649).click();
    await it.idle();
    expect(it.mark(206649)).toMatchObject({ badge: "Price is current", tone: "quiet" });
    expect(it.mark(206649).tip).toBe("Card Kingdom pays $27.00 each now, not the $28.50 each the price list said; the cart keeps its price.");
    expect([it.written.length, it.reloads.length, it.failed()]).toEqual([1, 0, false]);
    expect(it.update(224590).disabled).toBe(false);
  });

  test("what CK said is kept for the next page, until a newer list", async () => {
    const idb = new IDBFactory();
    const it = await marked({ idb, writes: () => Promise.resolve(answer("27.00", "27.00")) });
    it.update(206649).click();
    await it.idle();
    // The next page, on the same list: no Update price where CK said no.
    const next = await mountCart({ idb, kept: CKB.reducePrices(listed(), Date.now()) });
    expect(next.mark(206649)).toMatchObject({ verdict: "current", badge: "Price is current" });
    expect(next.mark(224590).verdict).toBe("better");
    // A newer list carries CK's prices itself, and what was said is dropped.
    const newer = listed();
    newer.meta.created_at = "2026-09-17 05:04:00";
    const later = await mountCart({ idb, kept: CKB.reducePrices(newer, Date.now()) });
    expect(later.mark(206649).verdict).toBe("better");
  });

  test("CK keeping the old price is kept for the next page too", async () => {
    const idb = new IDBFactory();
    const it = await marked({ idb, writes: () => Promise.resolve(answer("27.00", "28.50")) });
    it.update(206649).click();
    await it.idle();
    const next = await mountCart({ idb, kept: CKB.reducePrices(listed(), Date.now()) });
    expect(next.mark(206649)).toMatchObject({ verdict: "kept", badge: "Price kept" });
    expect(next.mark(206649).tip).toBe("Card Kingdom kept $27.00 each. Remove the card and add it again to take $28.50 each.");
  });

  test("a line CK priced lower is said in red, and every update locks", async () => {
    const it = await marked({ writes: () => Promise.resolve(answer("25.00", "25.00")) });
    it.update(206649).click();
    await it.idle();
    expect(it.mark(206649)).toMatchObject({ badge: "Price lowered", tone: "bad" });
    expect(it.mark(206649).tip).toBe(
      "Card Kingdom lowered this line to $25.00 each from $27.00 each, though the price list said $28.50 each. Reload the page to see what Card Kingdom holds."
    );
    expect([it.failed(), it.update(224590).disabled, it.reloads.length]).toEqual([true, true, 0]);
  });

  test("Update all moves past a current line and stops at a lowered one", async () => {
    const current = await marked({ writes: (url, o) => Promise.resolve(JSON.parse(o.body).product_id === "206649" ? answer("27.00", "27.00") : {
      ok: true, status: 200,
      json: () => Promise.resolve({ lineitems: [{ id: 5550002, product_id: 224590, style: "NM", qty: 1, price: "0.20", product: { price_buy: "0.20" } }] }),
    }) });
    current.all().querySelector("button").click();
    await current.idle();
    expect(current.written.length).toBe(2);
    expect(current.mark(206649).badge).toBe("Price is current");
    expect(current.reloads.length).toBe(1);

    const lowered = await marked({ writes: () => Promise.resolve(answer("25.00", "25.00")) });
    lowered.all().querySelector("button").click();
    await lowered.idle();
    expect(lowered.written.length).toBe(1);
    expect(lowered.mark(206649).badge).toBe("Price lowered");
    expect(lowered.reloads).toEqual([]);
  });
});

describe("checking the list with CK before updating", () => {
  const answer = {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        lineitems: [{ id: 5550001, product_id: 206649, style: "NM", qty: 1, price: "28.50", product: { price_buy: "28.50" } }],
      }),
  };
  const listed = () => pricelist({ 206649: { price_buy: "28.50" } });

  test("a newer list is read first, and a line no longer better sends nothing", async () => {
    // The kept list pays $28.50; CK's newer one pays the $27.00 the cart has.
    const newer = pricelist();
    newer.meta.created_at = "2026-09-17 05:04:00";
    const it = await mountCart({ kept: CKB.reducePrices(listed(), Date.now()), prices: newer, writes: () => Promise.resolve(answer) });
    await it.idle();
    it.update(206649).click();
    await it.idle();
    expect(it.asked.length).toBe(2);
    expect(it.written).toEqual([]);
    expect(!!it.update(206649)).toBe(false);
    expect(it.tip().endsWith("Price list of 2026-09-17 05:04")).toBe(true);
  });

  test("a list read a while ago is checked before sending", async () => {
    const it = await mountCart({ prices: listed(), writes: () => Promise.resolve(answer) });
    it.button().click();
    await it.idle();
    it.window.CKB.CHECK_GAP = 0;
    it.update(206649).click();
    await it.idle();
    expect(it.asked.length).toBe(2);
    expect(it.written.length).toBe(1);
  });

  test("a list just read is not checked again", async () => {
    const it = await mountCart({ prices: listed(), writes: () => Promise.resolve(answer) });
    it.button().click();
    await it.idle();
    it.update(206649).click();
    await it.idle();
    expect([it.asked.length, it.written.length]).toEqual([1, 1]);
  });

  test("Update all reads a newer list first", async () => {
    const newer = pricelist();
    newer.meta.created_at = "2026-09-17 05:04:00";
    const it = await mountCart({ kept: CKB.reducePrices(listed(), Date.now()), prices: newer, writes: () => Promise.resolve(answer) });
    await it.idle();
    it.all().querySelector("button").click();
    await it.idle();
    expect([it.asked.length, it.written.length]).toEqual([2, 0]);
  });
});
