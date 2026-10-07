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
})(globalThis.CKB);
