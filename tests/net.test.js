import { test, expect, describe, afterEach } from "bun:test";
import { Window } from "happy-dom";
import { CKB } from "./helpers.js";

const URL_ = "https://www.cardkingdom.com/myaccount/order_history?page=2";

const saved = { fetch: globalThis.fetch, DOMParser: globalThis.DOMParser };
afterEach(() => {
  globalThis.fetch = saved.fetch;
  globalThis.DOMParser = saved.DOMParser;
});

// answer stands in for fetch, recording what it was asked.
function answer(response) {
  const asked = [];
  globalThis.fetch = (url, options) => {
    asked.push({ url, options });
    return typeof response === "function" ? response() : Promise.resolve(response);
  };
  return asked;
}

function headers(values = {}) {
  return { get: (name) => (name in values ? values[name] : null) };
}

describe("asking for a page", () => {
  test("answers with the page parsed", async () => {
    globalThis.DOMParser = new Window().DOMParser;
    answer({
      ok: true,
      status: 200,
      headers: headers(),
      text: () => Promise.resolve('<div class="orderHistoryWrapper"><table></table></div>'),
    });
    const doc = await CKB.fetchPage(URL_);
    expect(doc.querySelector(".orderHistoryWrapper table")).not.toBeNull();
  });

  test("asks with the visitor's session, for HTML, with a deadline", async () => {
    const asked = answer(() => Promise.reject(new Error("done looking")));
    await CKB.fetchPage(URL_).catch(() => {});
    expect(asked.length).toBe(1);
    expect(asked[0].url).toBe(URL_);
    expect(asked[0].options.credentials).toBe("same-origin");
    expect(asked[0].options.headers.Accept).toBe("text/html,application/xhtml+xml");
    expect(asked[0].options.signal).toBeInstanceOf(AbortSignal);
  });

  test("an ordinary refusal says what it was", async () => {
    answer({ ok: false, status: 503, headers: headers(), text: () => Promise.resolve("") });
    await expect(CKB.fetchPage(URL_)).rejects.toThrow("Card Kingdom answered 503");
  });

  test("a Cloudflare challenge is told apart from an ordinary refusal", async () => {
    answer({
      ok: false,
      status: 429,
      headers: headers({ "cf-mitigated": "challenge" }),
      text: () => Promise.resolve("<title>Just a moment...</title>"),
    });
    await expect(CKB.fetchPage(URL_)).rejects.toThrow(CKB.CHALLENGE);
  });

  test("a read that timed out says so in words", async () => {
    // The browser's own wording, "signal timed out", names the mechanism.
    answer(() => {
      const err = new Error("signal timed out");
      err.name = "TimeoutError";
      return Promise.reject(err);
    });
    await expect(CKB.fetchPage(URL_)).rejects.toThrow(CKB.TIMED_OUT);
  });
});

describe("the deadline", () => {
  test("aborts once its time is up", async () => {
    const signal = CKB.deadline(20);
    expect(signal.aborted).toBe(false);
    await CKB.after(60);
    expect(signal.aborted).toBe(true);
    expect(signal.reason.name).toBe("TimeoutError");
  });
});

describe("the pace", () => {
  test("waits at least as long as it is asked", async () => {
    const started = Date.now();
    await CKB.after(40);
    expect(Date.now() - started).toBeGreaterThanOrEqual(35);
  });

  test("no pause costs nothing", async () => {
    const started = Date.now();
    await CKB.after(0);
    expect(Date.now() - started).toBeLessThan(20);
  });

  test("pages are at least a second apart", () => {
    expect(CKB.PACE).toBeGreaterThanOrEqual(1000);
  });
});
