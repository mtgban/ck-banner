// Puts a year picker and Download CSV on Card Kingdom's order and selling
// history pages.
//
// The click walks the list from page 1 (history.js) and saves the chosen
// year's shipped or completed, paid orders. A walk that was refused or
// cancelled saves no file, and neither does one that found no orders.
//
// What a whole walk found is kept (store.js), no orders included, so it
// replaces what was kept before. The next click reads page 1 alone, and
// while page 1 is as it was the kept answer is given at once; the button
// then offers Rebuild, which always reads the list again.

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

  function none(y) {
    return page.none + (y === null ? "" : " in " + y);
  }

  // finish saves the walk's file, when it found orders, and answers with
  // what is kept of it: a walk that found none is kept as that answer.
  function finish(walked, y) {
    var picked = CKB.pick(walked.rows, page.kind, y);
    var name = "ck-" + page.kind + "-" + (y === null ? "all" : y) + ".csv";
    var file = { name: name, csv: "", count: picked.rows.length, read: pagesRead(walked) };
    if (picked.rows.length) {
      file.csv = CKB.toCSV(picked.rows);
      CKB.download(file.csv, name);
      panel.word(picked.rows.length + " " + page.done);
      panel.mark("done");
      panel.recap(recap(name, picked, walked));
    } else {
      panel.word(page.kind);
      panel.fail(none(y) + "; read " + pagesRead(walked) + ".");
    }
    // Every year's file keeps its rows too, so any one year can be cut from it.
    if (y === null) {
      file.rows = picked.rows.map(function (row) {
        return {
          orderID: row.orderID,
          status: row.status,
          orderDate: row.orderDate,
          completedOn: row.completedOn,
          amount: row.amount,
          year: CKB.yearOf(row, page.kind),
        };
      });
    }
    return file;
  }

  // served gives the kept answer for y, and turns the button into Rebuild.
  function served(file, y) {
    var since = " as built at " + clock(file.builtAt) + " from " + file.read +
      ": page 1 has not changed since. Rebuild reads the list again.";
    rebuild = true;
    go.textContent = "Rebuild";
    if (!file.count) {
      panel.word(page.kind);
      panel.fail(none(y) + "," + since);
      return;
    }
    CKB.download(file.csv, file.name);
    panel.word(file.count + " " + page.done);
    panel.mark("done");
    panel.recap("Saved " + file.name + " again," + since);
  }

  // cut hands out one year from the kept file of every year, with no walk.
  function cut(all, y) {
    var rows = all.rows.filter(function (row) {
      return row.year === y;
    });
    var built = "the every-year list built at " + clock(all.builtAt);
    rebuild = true;
    go.textContent = "Rebuild";
    if (!rows.length) {
      panel.word(page.kind);
      panel.fail(none(y) + ", in " + built + ".");
      return;
    }
    var name = "ck-" + page.kind + "-" + y + ".csv";
    CKB.download(CKB.toCSV(rows), name);
    panel.word(rows.length + " " + page.done);
    panel.mark("done");
    panel.recap("Saved " + name + " from " + built + ": page 1 has not changed since. Rebuild reads the list again.");
  }

  function kept(key) {
    return store
      .then(function (s) {
        return s.get(key);
      })
      .catch(function () {
        return null;
      });
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
        return Promise.all([kept(key), y === null ? null : kept(CKB.fileKey(page.kind, null))])
          .then(function (found) {
            if (stale()) {
              return null;
            }
            // The newer of the year's own answer and the every-year file
            // is given, so neither hides a later read of the list. Both
            // answer for the year by its rule: an every-year file built once
            // the year was over is as final for it as the year's own.
            var now = Date.now();
            var own = !force && CKB.usableFile(found[0], signature, y, now) ? found[0] : null;
            var all = !force && CKB.usableFile(found[1], signature, y, now) && Array.isArray(found[1].rows) ?
              found[1] : null;
            if (all && (!own || all.builtAt > own.builtAt)) {
              panel.busy(false);
              cut(all, y);
              return null;
            }
            if (own) {
              panel.busy(false);
              served(own, y);
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
        // A whole walk replaces what is kept, even one that found nothing.
        var file = finish(walked, y);
        file.v = CKB.FILE_VERSION;
        file.signature = signature;
        file.builtAt = Date.now();
        store
          .then(function (s) {
            return s.put(key, file);
          })
          .catch(function () {});
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
