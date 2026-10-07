import { test, expect, describe } from "bun:test";
import { readFileSync, readdirSync, existsSync, statSync } from "fs";

const root = new URL("../", import.meta.url);
const read = (name) => readFileSync(new URL(name, root), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const pkg = JSON.parse(read("package.json"));

// files lists every file under dir, relative to the repository root, or
// nothing when dir does not exist yet.
function files(dir) {
  const at = new URL(dir + "/", root);
  if (!existsSync(at)) {
    return [];
  }
  return readdirSync(at).flatMap((name) => {
    const path = dir + "/" + name;
    return statSync(new URL(path, root)).isDirectory() ? files(path) : [path];
  });
}

describe("the manifest", () => {
  test("asks for no permissions", () => {
    // The price list answers any origin, and everything else is the page's
    // own origin, so there is nothing to ask for.
    for (const key of [
      "permissions",
      "optional_permissions",
      "host_permissions",
      "optional_host_permissions",
      "background",
      "web_accessible_resources",
    ]) {
      expect(manifest[key]).toBeUndefined();
    }
  });

  test("names only files that exist", () => {
    const named = Object.values(manifest.icons);
    for (const cs of manifest.content_scripts || []) {
      named.push(...(cs.js || []), ...(cs.css || []));
    }
    expect(named.filter((name) => !existsSync(new URL(name, root)))).toEqual([]);
  });

  test("runs on the history pages and nowhere else", () => {
    expect(manifest.content_scripts.flatMap((cs) => cs.matches)).toEqual([
      "https://www.cardkingdom.com/myaccount/order_history*",
      "https://www.cardkingdom.com/myaccount/selling_history*",
    ]);
  });

  test("carries package.json's version", () => {
    expect(manifest.version).toBe(pkg.version);
  });
});

describe("the source", () => {
  test("calls no extension API", () => {
    // With no permissions there is nothing to call, and a call that slips in
    // would need one.
    const calling = files("src").filter((name) => /\b(chrome|browser)\.\w/.test(read(name)));
    expect(calling).toEqual([]);
  });

  test("names no site but Card Kingdom's", () => {
    const urls = files("src").flatMap((name) =>
      [...read(name).matchAll(/https?:\/\/[^/"'\s)]+/g)].map((m) => name + ": " + m[0])
    );
    expect(urls.filter((url) => !/: https:\/\/(www|api)\.cardkingdom\.com$/.test(url))).toEqual([]);
  });
});

describe("the panel", () => {
  test("is one fixed width", () => {
    // Anchored to the right edge, a panel that grew to fit its words would
    // move its controls under the cursor.
    const css = read("src/panel.css");
    const rule = /#ck-banner \{([^}]*)\}/.exec(css)[1];
    expect(rule).toMatch(/\swidth: 240px;/);
    expect(css).not.toMatch(/(min|max)-width/);
  });
});

describe("punctuation", () => {
  test("no em dash in the source, the docs or the config", () => {
    const names = [
      ...files("src"),
      ...files("scripts"),
      ...files(".github"),
      "README.md",
      "SPECIFICATIONS.md",
      "AGENTS.md",
      "manifest.json",
      "package.json",
    ];
    const dashed = names.filter((name) => {
      const text = read(name);
      return text.includes("\u2014") || text.includes("\\u2014") || text.includes("&mdash;");
    });
    expect(dashed).toEqual([]);
  });
});

describe("fixtures", () => {
  test("carry no session, address or tracking data", () => {
    // Fixtures are cut from saved pages of a signed-in account. What a cut
    // must never keep is checked here, on every fixture there is.
    const leaks = [];
    for (const name of files("tests/fixtures")) {
      const text = read(name);
      const tokens = [...text.matchAll(/name="_token"[^>]*value="([^"]*)"/g)].map((m) => m[1]);
      if (tokens.some((value) => value !== "TOKEN")) leaks.push(name + ": a real _token");
      if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(text)) leaks.push(name + ": an email address");
      if (/\d{15,}/.test(text)) leaks.push(name + ": a 15-plus digit run");
      if (/[A-Za-z0-9]{30,}/.test(text)) leaks.push(name + ": a 30-plus character token");
      if (/laravel_session|trkcnfrm|ups\.com|usps\.com|fedex\.com/i.test(text)) leaks.push(name + ": session or tracking");
    }
    expect(leaks).toEqual([]);
  });
});
