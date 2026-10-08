// Keeps the reduced price list for an hour, in IndexedDB on the page's own
// origin (no permission needed), or in memory for the page's life where
// IndexedDB cannot be opened, as in some private windows.
//
// A kept list is used only while it is fresh and only as it was written:
// an entry of another version or shape is treated as missing, never patched.

globalThis.CKB = globalThis.CKB || {};

(function (CKB) {
  "use strict";

  var DB = "ck-banner";
  var STORE = "cache";
  var LIST = "pricelist";
  var SEEN = "seen";

  // TTL is how long a list is fresh. At exactly an hour it is stale.
  CKB.LIST_TTL = 3600000;

  function memory() {
    var held = {};
    return {
      lasting: false,
      get: function (key) {
        return Promise.resolve(Object.prototype.hasOwnProperty.call(held, key) ? held[key] : null);
      },
      put: function (key, value) {
        held[key] = value;
        return Promise.resolve();
      },
    };
  }

  function request(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error);
      };
    });
  }

  function indexed(db) {
    return {
      lasting: true,
      get: function (key) {
        return request(db.transaction(STORE, "readonly").objectStore(STORE).get(key)).then(function (value) {
          return value === undefined ? null : value;
        });
      },
      put: function (key, value) {
        var tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, key);
        return new Promise(function (resolve, reject) {
          tx.oncomplete = function () {
            resolve();
          };
          tx.onerror = tx.onabort = function () {
            reject(tx.error);
          };
        });
      },
    };
  }

  // openStore answers with the IndexedDB store, or with one held in memory
  // when IndexedDB is missing or will not open. It never rejects.
  CKB.openStore = function (factory) {
    var idb = factory === undefined ? globalThis.indexedDB : factory;
    if (!idb) {
      return Promise.resolve(memory());
    }
    return new Promise(function (resolve) {
      var req;
      try {
        req = idb.open(DB, 1);
      } catch (err) {
        resolve(memory());
        return;
      }
      req.onupgradeneeded = function () {
        req.result.createObjectStore(STORE);
      };
      req.onsuccess = function () {
        resolve(indexed(req.result));
      };
      req.onerror = req.onblocked = function () {
        resolve(memory());
      };
    });
  };

  function arrays(list) {
    var all = [list.ids, list.names, list.buy, list.wants].concat(Array.isArray(list.scryfall) && list.scryfall.length === 4 ?
      list.scryfall : [null]);
    for (var i = 0; i < CKB.CONDITIONS.length; i++) {
      all.push(list.retail && list.retail[CKB.CONDITIONS[i]], list.stock && list.stock[CKB.CONDITIONS[i]]);
    }
    return all;
  }

  // fresh says whether a kept list may be used at now: this version, every
  // array present and the same length, and less than TTL old. A list dated
  // in the future (the clock moved back) is not fresh either.
  CKB.fresh = function (list, now) {
    if (!list || list.v !== CKB.LIST_VERSION || typeof list.fetchedAt !== "number" ||
        typeof list.createdAt !== "string") {
      return false;
    }
    var all = arrays(list);
    for (var i = 0; i < all.length; i++) {
      if (Object.prototype.toString.call(all[i]) !== "[object Int32Array]" || all[i].length !== list.ids.length ||
          !all[i].length) {
        return false;
      }
    }
    var age = now - list.fetchedAt;
    return age >= 0 && age < CKB.LIST_TTL;
  };

  // keptList is the kept list when it is fresh at now, else null.
  CKB.keptList = function (store, now) {
    return store.get(LIST).then(
      function (list) {
        return CKB.fresh(list, now) ? list : null;
      },
      function () {
        return null;
      }
    );
  };

  CKB.keepList = function (store, list) {
    return store.put(LIST, list);
  };

  // keptSeen is what CK's answers to Update price said it pays now, by
  // product id, against the list built at createdAt: an empty record for
  // any other list, since a newer one has CK's prices in it.
  CKB.keptSeen = function (store, createdAt) {
    return store.get(SEEN).then(
      function (seen) {
        return seen && seen.createdAt === createdAt && seen.prices && typeof seen.prices === "object" ? seen.prices : {};
      },
      function () {
        return {};
      }
    );
  };

  CKB.keepSeen = function (store, createdAt, prices) {
    return store.put(SEEN, { createdAt: createdAt, prices: prices });
  };
})(globalThis.CKB);
