// Reads Card Kingdom's order and selling history pages.
//
// Both pages hold one table whose header row is a row of th inside tbody.
// Columns are found by that header's text, never by a cell's id: ids repeat
// on every row, and on the selling history the status cell's attribute is
// misspelled "id-". The address column is never read.

globalThis.CKB = globalThis.CKB || {};

(function (CKB) {
  "use strict";

  // What tells the two pages apart: the address column's header, the status
  // an exported row has, and the date that sets its year.
  var KINDS = {
    purchases: { address: "Ship To", done: "SHIPPED", yearFrom: "ordered" },
    sales: { address: "Mailing Address", done: "COMPLETED", yearFrom: "completed" },
  };

  var HEADERS = ["Order ID", "Order Date", "Payment Method", "Status", "Total"];

  // The word ahead of a status date.
  var DATED = /^(?:Shipped|Received|Ships on)\s+/;

  function text(node) {
    return node ? node.textContent.replace(/\s+/g, " ").trim() : "";
  }

  // firstText is a cell's first non-empty text node, which is where the
  // status word sits, ahead of its date and any tracking link.
  function firstText(cell) {
    for (var i = 0; i < cell.childNodes.length; i++) {
      var node = cell.childNodes[i];
      if (node.nodeType === 3 && node.textContent.trim()) {
        return node.textContent.trim();
      }
    }
    return "";
  }

  function header(table, kind) {
    var rows = table.querySelectorAll("tr");
    for (var i = 0; i < rows.length; i++) {
      var cells = rows[i].querySelectorAll("th");
      if (!cells.length) {
        continue;
      }
      var at = {};
      for (var j = 0; j < cells.length; j++) {
        at[text(cells[j])] = j;
      }
      var wanted = HEADERS.concat([KINDS[kind].address]);
      for (var k = 0; k < wanted.length; k++) {
        if (!(wanted[k] in at)) {
          throw new Error("The history table has no " + wanted[k] + " column");
        }
      }
      at.width = cells.length;
      return at;
    }
    throw new Error("The history table has no header row");
  }

  function readRow(tr, at) {
    var cells = tr.querySelectorAll("td");
    var orderID = cells.length === at.width ? text(cells[at["Order ID"]]) : "";
    if (!/^\d+$/.test(orderID)) {
      throw new Error("A history row could not be read (" + (orderID || "no order id") + ")");
    }

    var status = cells[at["Status"]];
    var span = status.querySelector("span");
    var completedOn = span ? text(span).replace(DATED, "") : "";
    var paid = cells[at["Payment Method"]].querySelector("span");
    var row = {
      orderID: orderID,
      orderDate: text(cells[at["Order Date"]]),
      status: firstText(status).toUpperCase(),
      completedOn: completedOn,
      paid: paid ? text(paid).split(" ")[0] : "",
      amount: text(cells[at["Total"]]),
    };

    row.ordered = CKB.when(row.orderDate);
    if (!row.ordered) {
      throw new Error("Order " + orderID + " has an order date that could not be read: " + row.orderDate);
    }
    row.completed = completedOn ? CKB.when(completedOn) : null;
    if (completedOn && !row.completed) {
      throw new Error("Order " + orderID + " has a status date that could not be read: " + completedOn);
    }
    if (CKB.cents(row.amount) === null) {
      throw new Error("Order " + orderID + " has a total that could not be read: " + row.amount);
    }
    return row;
  }

  // readHistory reads every order on one history page, newest first as the
  // page lists them, and throws when the page is not one it can read whole.
  CKB.readHistory = function (doc, kind) {
    if (!KINDS[kind]) {
      throw new Error("Unknown history: " + kind);
    }
    var table = doc.querySelector("div.orderHistoryWrapper table");
    if (!table) {
      throw new Error("There is no history table on the page");
    }
    var at = header(table, kind);
    var rows = [];
    var trs = table.querySelectorAll("tr");
    for (var i = 0; i < trs.length; i++) {
      if (trs[i].querySelector("td")) {
        rows.push(readRow(trs[i], at));
      }
    }
    return rows;
  };

  // exported says whether a row belongs in the file: the page's own finished
  // status, and paid.
  CKB.exported = function (row, kind) {
    return row.status === KINDS[kind].done && row.paid === "Paid";
  };

  // yearOf is the year a row is filed under: its order date's for a
  // purchase, its Received date's for a sale, or null when it has none.
  CKB.yearOf = function (row, kind) {
    var when = row[KINDS[kind].yearFrom];
    return when ? when.year : null;
  };

  // pick takes the rows the file holds for a year, null for every year, and
  // counts what it left out: by status, unpaid, and from other years. A row
  // that would be exported but has no date to file it under refuses the file.
  CKB.pick = function (rows, kind, year) {
    var picked = { rows: [], skipped: {}, unpaid: 0, otherYears: 0 };
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!CKB.exported(row, kind)) {
        if (row.status === KINDS[kind].done) {
          picked.unpaid++;
        } else {
          picked.skipped[row.status] = (picked.skipped[row.status] || 0) + 1;
        }
        continue;
      }
      var filed = CKB.yearOf(row, kind);
      if (filed === null) {
        throw new Error("Order " + row.orderID + " is " + row.status + " but carries no date to file it under");
      }
      if (year !== null && filed !== year) {
        picked.otherYears++;
        continue;
      }
      picked.rows.push(row);
    }
    return picked;
  };

  function count(digits) {
    return Number(digits.replace(/,/g, ""));
  }

  // historyPlace reads where a page sits in the list, from its results line
  // ("26 - 50 of 210 results") and its final page link, when it has one.
  CKB.historyPlace = function (doc) {
    var line = text(doc.querySelector("div.orderHistoryWrapper .resultsCount"));
    var m = /^([\d,]+) - ([\d,]+) of ([\d,]+) results?$/.exec(line);
    if (!m || count(m[2]) < count(m[1])) {
      throw new Error("The page does not say how many orders the history holds");
    }
    var final = doc.querySelector('a[aria-label="Display Final Results Page"]');
    if (final && !/^\d+$/.test(text(final))) {
      throw new Error("The page's final page link does not name a page");
    }
    return {
      first: count(m[1]),
      last: count(m[2]),
      total: count(m[3]),
      pages: final ? Number(text(final)) : null,
    };
  };

  function stamp(when) {
    return (((when.year * 13 + when.month) * 32 + when.day) * 24 + when.hour) * 60 + when.minute;
  }

  // walkHistory reads the whole list from page 1, one page at a time, and
  // answers with every row read. Rather than answer with less than the list,
  // it refuses: a page that is short or out of place, an order seen twice, or
  // a list whose size changes while it is read.
  //
  // With a year, purchases stop after the first page holding an older order,
  // as long as every order so far came newest first. Sales never stop early:
  // a sale's year is its Received date, which the list is not sorted by.
  //
  // options: year, fetchPage, pace, cancelled() and progress(page, pages).
  CKB.walkHistory = function (kind, base, options) {
    var opts = options || {};
    var fetchPage = opts.fetchPage || CKB.fetchPage;
    var pace = opts.pace === undefined ? CKB.PACE : opts.pace;
    var cancelled = opts.cancelled || function () {
      return false;
    };
    var progress = opts.progress || function () {};
    var stopBelow = kind === "purchases" && opts.year ? opts.year : null;

    var walked = { rows: [], pages: 0, pageCount: 0, total: 0, stoppedEarly: false, cancelled: false };
    var seen = {};
    var sorted = true;
    var newest = Infinity;
    var per = 0;

    function take(n, doc) {
      var rows = CKB.readHistory(doc, kind);
      var place = CKB.historyPlace(doc);
      if (n === 1) {
        if (place.first !== 1) {
          throw new Error("Page 1 did not start at the first order");
        }
        per = place.last;
        walked.total = place.total;
        walked.pageCount = Math.ceil(place.total / per);
        if (place.pages !== null && place.pages !== walked.pageCount) {
          throw new Error(
            "The history holds " + place.total + " orders at " + per + " a page, but its pager says " + place.pages + " pages"
          );
        }
      }

      var first = (n - 1) * per + 1;
      var last = Math.min(n * per, walked.total);
      var moved = place.first !== first || place.last !== last || place.total !== walked.total;
      if (moved || (place.pages !== null && place.pages !== walked.pageCount)) {
        throw new Error("The history changed while it was read (page " + n + "), so nothing was saved");
      }
      if (rows.length !== last - first + 1) {
        throw new Error("Page " + n + " came back with " + rows.length + " of " + (last - first + 1) + " orders, so nothing was saved");
      }

      for (var i = 0; i < rows.length; i++) {
        if (seen[rows[i].orderID]) {
          throw new Error("Order " + rows[i].orderID + " was listed twice, so the history changed while it was read");
        }
        seen[rows[i].orderID] = true;
        var at = stamp(rows[i].ordered);
        if (at > newest) {
          sorted = false;
        }
        newest = at;
        walked.rows.push(rows[i]);
      }
      walked.pages = n;
      return rows;
    }

    function older(rows) {
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].ordered.year < stopBelow) {
          return true;
        }
      }
      return false;
    }

    function stop() {
      walked.cancelled = true;
      walked.rows = [];
      return walked;
    }

    function step(n) {
      return CKB.after(n === 1 ? 0 : pace).then(function () {
        if (cancelled()) {
          return stop();
        }
        return fetchPage(base + "?page=" + n).then(function (doc) {
          // A page that arrives after Escape is dropped, not kept.
          if (cancelled()) {
            return stop();
          }
          var rows = take(n, doc);
          progress(n, walked.pageCount);
          if (n >= walked.pageCount) {
            return walked;
          }
          if (stopBelow && sorted && older(rows)) {
            walked.stoppedEarly = true;
            return walked;
          }
          return step(n + 1);
        });
      });
    }

    return step(1);
  };
})(globalThis.CKB);
