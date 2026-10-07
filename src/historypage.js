// Puts a year picker and Download CSV on Card Kingdom's order and selling
// history pages.
//
// The click walks the whole list from page 1 (history.js) and saves the
// chosen year's shipped or completed, paid orders. A walk that was refused
// or cancelled saves nothing, and neither does one that found no orders.
//
// A saved file is kept (store.js). The next click reads page 1 alone, and
// while page 1 is as it was the kept file downloads at once; the button then
// offers Rebuild, which always reads the list again.

(function (CKB) {
  "use strict";

  var PAGES = {
    "/myaccount/order_history": {
      kind: "purchases",
      every: "Every shipped, paid purchase",
      within: "ordered in",
      none: "No shipped, paid purchases",
      done: "shipped",
      basis: "filed by order date",
    },
    "/myaccount/selling_history": {
      kind: "sales",
      every: "Every completed, paid sale",
      within: "Card Kingdom received in",
      none: "No completed, paid sales",
      done: "completed",
      basis: "filed by the date Card Kingdom received them",
    },
  };

  // The year Card Kingdom opened, so no account's history is out of reach.
  var FIRST_YEAR = 1999;

  var page = PAGES[location.pathname.replace(/\/+$/, "")];
  if (!page) {
    return;
  }

  var panel = null;
  var year = null;
  var go = null;
  var generation = 0;
  var store = null;
  // rebuild is set once a kept file was handed out for the chosen year.
  var rebuild = false;

  function chosen() {
    return year.value === "all" ? null : Number(year.value);
  }

  function plural(n, one, many) {
    return n + " " + (n === 1 ? one : many);
  }

  function idle() {
    var y = chosen();
    rebuild = false;
    go.textContent = "Download CSV";
    panel.word(page.kind);
    panel.clear();
    panel.hint(page.every + (y === null ? "" : " " + page.within + " " + y) + ", as a CSV with one row per order");
  }

  function pagesRead(walked) {
    return plural(walked.pages, "page", "pages");
  }

  // recap is what a saved file says about itself on the tooltip: what is in
  // it, how much was read, and what was left out and why.
  function recap(name, picked, walked) {
    var left = [];
    for (var status in picked.skipped) {
      left.push(picked.skipped[status] + " " + status);
    }
    if (picked.unpaid) {
      left.push(picked.unpaid + " unpaid");
    }
    if (picked.otherYears) {
      left.push(picked.otherYears + " from other years");
    }
    return (
      "Saved " + name + ": " + plural(picked.rows.length, "order", "orders") + ", " + page.basis + ". " +
      "Read " + pagesRead(walked) + (left.length ? "; left out " + left.join(", ") : "") + "."
    );
  }

  function clock(ms) {
    var at = new Date(ms);
    return String(at.getHours()).padStart(2, "0") + ":" + String(at.getMinutes()).padStart(2, "0");
  }

  // finish saves the walk's file and answers with what is kept of it, or
  // with null when there was nothing to save.
  function finish(walked, y) {
    var picked = CKB.pick(walked.rows, page.kind, y);
    if (!picked.rows.length) {
      panel.word(page.kind);
      panel.fail(page.none + (y === null ? "" : " in " + y) + "; read " + pagesRead(walked) + ".");
      return null;
    }
    var name = "ck-" + page.kind + "-" + (y === null ? "all" : y) + ".csv";
    var csv = CKB.toCSV(picked.rows);
    CKB.download(csv, name);
    panel.word(picked.rows.length + " " + page.done);
    panel.mark("done");
    panel.recap(recap(name, picked, walked));
    return { name: name, csv: csv, count: picked.rows.length, read: pagesRead(walked) };
  }

  // served hands out a kept file, and turns the button into Rebuild.
  function served(file) {
    CKB.download(file.csv, file.name);
    panel.word(file.count + " " + page.done);
    panel.mark("done");
    panel.recap(
      "Saved " + file.name + " again, as built at " + clock(file.builtAt) + " from " + file.read +
      ": page 1 has not changed since. Rebuild reads the list again."
    );
    rebuild = true;
    go.textContent = "Rebuild";
  }

  function run() {
    var mine = ++generation;
    function stale() {
      return mine !== generation;
    }
    var y = chosen();
    var key = CKB.fileKey(page.kind, y);
    var base = location.origin + location.pathname;
    var force = rebuild;
    var signature = "";
    panel.clear();
    panel.word("reading");
    panel.busy(true);

    CKB.fetchPage(base + "?page=1")
      .then(function (first) {
        if (stale()) {
          return null;
        }
        signature = CKB.historySignature(first, page.kind);
        return store
          .then(function (s) {
            return s.get(key);
          })
          .catch(function () {
            return null;
          })
          .then(function (kept) {
            if (stale()) {
              return null;
            }
            if (!force && CKB.usableFile(kept, signature, y, Date.now())) {
              panel.busy(false);
              served(kept);
              return null;
            }
            return CKB.walkHistory(page.kind, base, {
              year: y,
              first: first,
              cancelled: stale,
              progress: function (n) {
                if (!stale()) {
                  panel.word("page " + n);
                }
              },
            });
          });
      })
      .then(function (walked) {
        if (!walked || stale() || walked.cancelled) {
          return;
        }
        panel.busy(false);
        rebuild = false;
        go.textContent = "Download CSV";
        var file = finish(walked, y);
        // Only a whole, successful walk replaces what is kept.
        if (file) {
          file.v = CKB.FILE_VERSION;
          file.signature = signature;
          file.builtAt = Date.now();
          store
            .then(function (s) {
              return s.put(key, file);
            })
            .catch(function () {});
        }
      })
      .catch(function (err) {
        if (stale()) {
          return;
        }
        panel.busy(false);
        panel.word(page.kind);
        panel.fail(err && err.message ? err.message : String(err));
      });
  }

  function install() {
    if (document.getElementById("ck-banner")) {
      return;
    }
    panel = CKB.panel();
    store = CKB.openStore();

    year = document.createElement("select");
    year.className = "ck-banner-year";
    year.setAttribute("aria-label", "Year");
    var now = new Date().getFullYear();
    var choices = [["all", "All years"]];
    for (var y = now; y >= FIRST_YEAR; y--) {
      choices.push([String(y), String(y)]);
    }
    for (var i = 0; i < choices.length; i++) {
      var option = document.createElement("option");
      option.value = choices[i][0];
      option.textContent = choices[i][1];
      year.appendChild(option);
    }
    year.value = String(now);

    go = document.createElement("button");
    go.type = "button";
    go.className = "ck-banner-go";
    go.textContent = "Download CSV";

    panel.actions.appendChild(year);
    panel.actions.appendChild(go);
    // A page without the table (a sign-in page at this address) gets no panel.
    panel.root.hidden = !document.querySelector("div.orderHistoryWrapper table");
    document.body.appendChild(panel.root);
    idle();

    year.addEventListener("change", idle);
    go.addEventListener("click", run);
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape" || !panel.working()) {
        return;
      }
      generation++;
      panel.busy(false);
      idle();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install);
  } else {
    install();
  }
})(globalThis.CKB);
