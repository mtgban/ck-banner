import { test, expect, describe } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { CKB, text } from "./helpers.js";

const NOW = 1790000000000;
const list = (at = NOW) => CKB.reducePrices(JSON.parse(text("pricelist.json")), at);

describe("where the list is kept", () => {
  test("IndexedDB keeps it as it was written", async () => {
    const store = await CKB.openStore(new IDBFactory());
    expect(store.lasting).toBe(true);
    await CKB.keepList(store, list());
    const kept = await CKB.keptList(store, NOW + 1000);
    expect(kept.ids).toBeInstanceOf(Int32Array);
    expect([...kept.ids]).toEqual([...list().ids]);
    expect([...kept.retail.VG]).toEqual([...list().retail.VG]);
    expect(kept.createdAt).toBe("2026-09-17 04:04:33");
  });

  test("a second visit reads what the first one kept", async () => {
    const idb = new IDBFactory();
    await CKB.keepList(await CKB.openStore(idb), list());
    const later = await CKB.openStore(idb);
    expect(await CKB.keptList(later, NOW + 60000)).not.toBeNull();
  });

  test("without IndexedDB it is held in memory", async () => {
    const store = await CKB.openStore(null);
    expect(store.lasting).toBe(false);
    expect(await CKB.keptList(store, NOW)).toBeNull();
    await CKB.keepList(store, list());
    expect(await CKB.keptList(store, NOW)).not.toBeNull();
  });

  test("an IndexedDB that will not open falls back to memory", async () => {
    // As some private windows behave: open throws, or errors.
    const throwing = { open: () => { throw new Error("SecurityError"); } };
    expect((await CKB.openStore(throwing)).lasting).toBe(false);
    const failing = {
      open: () => {
        const req = {};
        setTimeout(() => req.onerror && req.onerror());
        return req;
      },
    };
    expect((await CKB.openStore(failing)).lasting).toBe(false);
  });

  test("a store that fails to read gives no list", async () => {
    const broken = { get: () => Promise.reject(new Error("gone")) };
    expect(await CKB.keptList(broken, NOW)).toBeNull();
  });
});

describe("an hour", () => {
  test("a list less than an hour old is fresh", () => {
    expect(CKB.fresh(list(), NOW)).toBe(true);
    expect(CKB.fresh(list(), NOW + CKB.LIST_TTL - 1)).toBe(true);
  });

  test("a list exactly an hour old is stale", () => {
    expect(CKB.fresh(list(), NOW + CKB.LIST_TTL)).toBe(false);
  });

  test("a list dated in the future is not used", () => {
    // The clock moved back since it was kept.
    expect(CKB.fresh(list(), NOW - 1)).toBe(false);
  });

  test("a stale list is never handed out", async () => {
    const store = await CKB.openStore(null);
    await CKB.keepList(store, list());
    expect(await CKB.keptList(store, NOW + CKB.LIST_TTL)).toBeNull();
  });
});

describe("a kept list of the wrong shape", () => {
  test("a list of another version is not used", () => {
    expect(CKB.fresh({ ...list(), v: CKB.LIST_VERSION + 1 }, NOW)).toBe(false);
  });

  test("a missing or retyped array makes it missing", () => {
    const l = list();
    expect(CKB.fresh({ ...l, buy: undefined }, NOW)).toBe(false);
    expect(CKB.fresh({ ...l, buy: [...l.buy] }, NOW)).toBe(false);
    expect(CKB.fresh({ ...l, retail: { ...l.retail, G: undefined } }, NOW)).toBe(false);
    expect(CKB.fresh({ ...l, wants: l.wants.slice(1) }, NOW)).toBe(false);
    expect(CKB.fresh({ ...l, scryfall: undefined }, NOW)).toBe(false);
    expect(CKB.fresh({ ...l, scryfall: l.scryfall.slice(1) }, NOW)).toBe(false);
  });

  test("nothing kept is nothing", () => {
    expect(CKB.fresh(null, NOW)).toBe(false);
    expect(CKB.fresh(undefined, NOW)).toBe(false);
    expect(CKB.fresh({}, NOW)).toBe(false);
  });
});
