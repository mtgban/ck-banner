// Puts a year picker and Download CSV on Card Kingdom's order and selling
// history pages.
//
// The click walks the whole list from page 1 (history.js) and saves the
// chosen year's shipped or completed, paid orders. A walk that was refused
// or cancelled saves nothing, and neither does one that found no orders.

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
  var generation = 0;

  function chosen() {
    return year.value === "all" ? null : Number(year.value);
  }

  function plural(n, one, many) {
    return n + " " + (n === 1 ? one : many);
  }

  function idle() {
    var y = chosen();
    panel.word(page.kind);
    panel.clear();
    panel.hint(page.every + (y === null ? "" : " " + page.within + " " + y) + ", as a CSV with one row per order");
  }

  function pagesRead(walked) {
    if (walked.pages === walked.pageCount) {
      return plural(walked.pages, "page", "pages");
    }
    return walked.pages + " of " + walked.pageCount + " pages, the rest being older";
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

  function finish(walked, y) {
    var picked = CKB.pick(walked.rows, page.kind, y);
    if (!picked.rows.length) {
      panel.word(page.kind);
      panel.fail(page.none + (y === null ? "" : " in " + y) + "; read " + pagesRead(walked) + ".");
      return;
    }
    var name = "ck-" + page.kind + "-" + (y === null ? "all" : y) + ".csv";
    CKB.download(CKB.toCSV(picked.rows), name);
    panel.word(picked.rows.length + " " + page.done);
    panel.mark("done");
    panel.recap(recap(name, picked, walked));
  }

  function run() {
    var mine = ++generation;
    function stale() {
      return mine !== generation;
    }
    var y = chosen();
    panel.clear();
    panel.word("reading");
    panel.busy(true);

    CKB.walkHistory(page.kind, location.origin + location.pathname, {
      year: y,
      cancelled: stale,
      progress: function (n, pages) {
        if (!stale()) {
          panel.word(n + " / " + pages + " pages");
        }
      },
    })
      .then(function (walked) {
        if (stale() || walked.cancelled) {
          return;
        }
        panel.busy(false);
        finish(walked, y);
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

    var go = document.createElement("button");
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
