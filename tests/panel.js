// Stands a content script up the way the browser does: one window at a Card
// Kingdom address, the scripts the manifest names in its order, evaluated in
// that window so that document and location mean what they mean in a tab.
// Everything that would leave the page is recorded instead.
//
// The window has a Card Kingdom URL, so what it is given must name nothing
// it could fetch: the fixtures carry no script, stylesheet or image.

import { Window } from "happy-dom";
import { readFileSync } from "fs";
import { pageHTML } from "./helpers.js";

const SITE = "https://www.cardkingdom.com";
const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

function source(name) {
  return readFileSync(new URL("../" + name, import.meta.url), "utf8");
}

// scriptsFor is the manifest's list of scripts for a path, in its order.
function scriptsFor(path) {
  for (const entry of manifest.content_scripts) {
    if (entry.matches.some((match) => (SITE + path).startsWith(match.replace(/\*$/, "")))) {
      return entry.js;
    }
  }
  throw new Error("no content script runs on " + path);
}

// mountHistory opens an order (purchases) or selling (sales) history page
// whose list holds total orders, served page by page out of the fixtures.
// change[n] rewrites page n's markup, or answers with an Error or a Promise
// to fail or hold its fetch.
export function mountHistory({ kind = "purchases", total = 210, change = {}, body } = {}) {
  const name = kind === "sales" ? "selling-history.html" : "order-history.html";
  const path = kind === "sales" ? "/myaccount/selling_history" : "/myaccount/order_history";
  const window = new Window({
    url: SITE + path,
    settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true },
  });
  window.document.body.innerHTML = body ?? pageHTML(name, { n: 1, total });

  const asked = [];
  window.fetch = (url) => {
    asked.push(String(url));
    const n = Number(/[?&]page=(\d+)$/.exec(url)[1]);
    const html = pageHTML(name, { n, total });
    const answer = change[n] ? change[n](html) : html;
    if (answer instanceof Error) {
      return Promise.reject(answer);
    }
    return Promise.resolve(answer).then((text) => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: () => Promise.resolve(text),
    }));
  };

  const saved = [];
  window.URL.createObjectURL = (blob) => {
    saved.push({ blob });
    return "blob:none";
  };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () {
    saved[saved.length - 1].name = this.download;
  };

  for (const script of scriptsFor(path)) {
    window.eval(source(script));
  }
  window.CKB.PACE = 0;

  const panel = window.document.getElementById("ck-banner");
  const at = (selector) => panel.querySelector(selector);

  return {
    window,
    panel,
    asked,
    saved,
    // What the heading says out loud: the mark only when it is shown.
    heading: () =>
      [...at(".ck-banner-label").childNodes]
        .filter((node) => !node.hidden)
        .map((node) => node.textContent)
        .join(""),
    word: () => at(".ck-banner-word").textContent,
    tip: () => at(".ck-banner-tip").textContent,
    year: () => at(".ck-banner-year"),
    go: () => at(".ck-banner-go"),
    markShown: () => !at(".ck-banner-mark").hidden,
    failed: () => !at(".ck-banner-mark").hidden && at(".ck-banner-mark").classList.contains("ck-banner-failed"),
    busy: () => panel.classList.contains("ck-banner-busy"),
    titled: () => panel.querySelectorAll("[title]").length,
    // Whatever sits under the row of controls, which nothing should.
    below: () => {
      const children = [...panel.children];
      return children.slice(children.indexOf(at(".ck-banner-actions")) + 1).length;
    },
    choose: (value) => {
      at(".ck-banner-year").value = value;
      at(".ck-banner-year").dispatchEvent(new window.Event("change"));
    },
    leaving: () => {
      const event = new window.Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    },
    escape: () => window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" })),
    file: async (i = 0) => ({ name: saved[i].name, text: await saved[i].blob.text() }),
    settle: (ms = 30) => new Promise((done) => setTimeout(done, ms)),
  };
}
