// Reads Card Kingdom's price list and keeps what the carts are compared with.
//
// The list is public: CK answers it to any origin, so it is fetched without
// cookies and without custom headers, which keeps the request simple enough
// to need no preflight and the extension free of host permissions. It is
// about 70 MB of JSON; what is kept of it is a set of arrays sorted by id.

globalThis.CKB = globalThis.CKB || {};

(function (CKB) {
  "use strict";

  CKB.PRICELIST = "https://api.cardkingdom.com/api/v2/pricelist";

  // TIMEOUT bounds the whole read, download included. A guess until the live
  // checks measure the download in Chrome and Firefox.
  var TIMEOUT = 120000;

  CKB.LIST_TIMED_OUT = "Card Kingdom's price list did not arrive in time";
  CKB.LIST_UNREADABLE = "Card Kingdom's price list could not be read";

  // The version of the kept shape; a kept list of another is read as none.
  CKB.LIST_VERSION = 1;

  CKB.CONDITIONS = ["NM", "EX", "VG", "G"];

  // listName is a row's card as the carts' images name it:
  // "Edition[ Foil]: Name[ (Variation)]".
  CKB.listName = function (row) {
    return (
      row.edition + (row.is_foil === "true" ? " Foil" : "") + ": " + row.name +
      (row.variation ? " (" + row.variation + ")" : "")
    );
  };

  // nameKey folds a card's name into 32 bits (FNV-1a), enough to tell a
  // cart line's card from the list row its id points at.
  CKB.nameKey = function (text) {
    var h = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h | 0;
  };

  function count(value) {
    return typeof value === "number" && value >= 0 && value === Math.floor(value) ? value : null;
  }

  // readRow is a row's kept values, or null when any of them is not the
  // shape the list publishes: such a row is skipped, never patched.
  function readRow(row) {
    if (!row || typeof row !== "object" || count(row.id) === null || row.id === 0 || row.id > 2147483647) {
      return null;
    }
    var values = row.condition_values || {};
    var kept = {
      id: row.id,
      name: typeof row.name === "string" && typeof row.edition === "string" &&
        typeof row.variation === "string" && (row.is_foil === "true" || row.is_foil === "false")
        ? CKB.nameKey(CKB.listName(row)) : null,
      buy: CKB.listCents(row.price_buy),
      wants: count(row.qty_buying),
      retail: {},
      stock: {},
    };
    if (kept.name === null || kept.buy === null || kept.wants === null) {
      return null;
    }
    for (var i = 0; i < CKB.CONDITIONS.length; i++) {
      var c = CKB.CONDITIONS[i].toLowerCase();
      kept.retail[CKB.CONDITIONS[i]] = CKB.listCents(values[c + "_price"]);
      kept.stock[CKB.CONDITIONS[i]] = count(values[c + "_qty"]);
      if (kept.retail[CKB.CONDITIONS[i]] === null || kept.stock[CKB.CONDITIONS[i]] === null) {
        return null;
      }
    }
    return kept;
  }

  // reducePrices keeps, for every well-formed row, sorted by id: the name
  // key, the buy price and quantity the sell cart is compared with, and each
  // condition's retail price and stock for the buy cart. A malformed row is
  // skipped and counted; an id listed twice is dropped altogether, since
  // which of its rows is right cannot be told.
  CKB.reducePrices = function (body, now) {
    if (!body || typeof body !== "object" || !Array.isArray(body.data) || !body.meta ||
        typeof body.meta.created_at !== "string") {
      throw new Error(CKB.LIST_UNREADABLE);
    }
    var rows = [];
    var skipped = 0;
    for (var i = 0; i < body.data.length; i++) {
      var kept = readRow(body.data[i]);
      if (kept) {
        rows.push(kept);
      } else {
        skipped++;
      }
    }
    rows.sort(function (a, b) {
      return a.id - b.id;
    });
    var unique = [];
    for (var j = 0; j < rows.length; j++) {
      var twin = (j > 0 && rows[j - 1].id === rows[j].id) || (j + 1 < rows.length && rows[j + 1].id === rows[j].id);
      if (twin) {
        skipped++;
      } else {
        unique.push(rows[j]);
      }
    }
    if (!unique.length) {
      throw new Error(CKB.LIST_UNREADABLE);
    }

    var n = unique.length;
    var list = {
      v: CKB.LIST_VERSION,
      createdAt: body.meta.created_at,
      fetchedAt: now,
      skipped: skipped,
      ids: new Int32Array(n),
      names: new Int32Array(n),
      buy: new Int32Array(n),
      wants: new Int32Array(n),
      retail: {},
      stock: {},
    };
    CKB.CONDITIONS.forEach(function (c) {
      list.retail[c] = new Int32Array(n);
      list.stock[c] = new Int32Array(n);
    });
    for (var k = 0; k < n; k++) {
      list.ids[k] = unique[k].id;
      list.names[k] = unique[k].name;
      list.buy[k] = unique[k].buy;
      list.wants[k] = unique[k].wants;
      for (var m = 0; m < CKB.CONDITIONS.length; m++) {
        var cond = CKB.CONDITIONS[m];
        list.retail[cond][k] = unique[k].retail[cond];
        list.stock[cond][k] = unique[k].stock[cond];
      }
    }
    return list;
  };

  // lookup is the kept row for a product id, or null when the list has none.
  CKB.lookup = function (list, id) {
    var lo = 0;
    var hi = list.ids.length - 1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (list.ids[mid] === id) {
        var row = { id: id, name: list.names[mid], buy: list.buy[mid], wants: list.wants[mid], retail: {}, stock: {} };
        for (var i = 0; i < CKB.CONDITIONS.length; i++) {
          row.retail[CKB.CONDITIONS[i]] = list.retail[CKB.CONDITIONS[i]][mid];
          row.stock[CKB.CONDITIONS[i]] = list.stock[CKB.CONDITIONS[i]][mid];
        }
        return row;
      }
      if (list.ids[mid] < id) {
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return null;
  };

  // fetchList reads and reduces the list. options.signal aborts it (Escape);
  // options.timeout bounds it. A read that was aborted rejects with the
  // browser's AbortError, which a caller treats as cancelled, not failed.
  CKB.fetchList = function (options) {
    var opts = options || {};
    var controller = new AbortController();
    var timedOut = false;
    var timer = setTimeout(function () {
      timedOut = true;
      controller.abort();
    }, opts.timeout || TIMEOUT);
    if (opts.signal) {
      if (opts.signal.aborted) {
        controller.abort();
      } else {
        opts.signal.addEventListener("abort", function () {
          controller.abort();
        });
      }
    }

    return fetch(CKB.PRICELIST, { credentials: "omit", signal: controller.signal })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Card Kingdom's price list answered " + response.status);
        }
        return response.json().catch(function () {
          throw new Error(CKB.LIST_UNREADABLE);
        });
      })
      .then(function (body) {
        return CKB.reducePrices(body, Date.now());
      })
      .then(
        function (list) {
          clearTimeout(timer);
          return list;
        },
        function (err) {
          clearTimeout(timer);
          if (timedOut) {
            throw new Error(CKB.LIST_TIMED_OUT);
          }
          throw err;
        }
      );
  };
})(globalThis.CKB);
