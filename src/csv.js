// Writes the history and the carts out as CSV, byte for byte what Go's
// csv.Writer writes for the same rows: the same quoting, one LF per row.
//
// The history's five columns and their header are a contract: spreadsheets
// already built on that file read them by name. Every value in it is written
// as Card Kingdom prints it.

globalThis.CKB = globalThis.CKB || {};

(function (CKB) {
  "use strict";

  // [header, field of a history row]
  var COLUMNS = [
    ["Order ID", "orderID"],
    ["Order Status", "status"],
    ["Order Date", "orderDate"],
    ["Completed on", "completedOn"],
    ["Amount", "amount"],
  ];

  // field quotes what has to be quoted and nothing else.
  function field(value) {
    var text = value === undefined || value === null ? "" : String(value);
    if (/[",\r\n]/.test(text)) {
      return '"' + text.replace(/"/g, '""') + '"';
    }
    return text;
  }

  function row(values) {
    var quoted = [];
    for (var i = 0; i < values.length; i++) {
      quoted.push(field(values[i]));
    }
    return quoted.join(",");
  }

  // table writes a header and one line per row of values.
  function table(header, rows) {
    var lines = [row(header)];
    for (var i = 0; i < rows.length; i++) {
      lines.push(row(rows[i]));
    }
    return lines.join("\n") + "\n";
  }

  // toCSV writes the header and one line per history row, in the order given.
  CKB.toCSV = function (rows) {
    return table(CKB.csvColumns(), rows.map(function (r) {
      return COLUMNS.map(function (column) {
        return r[column[1]];
      });
    }));
  };

  function decimal(cents) {
    return cents === null ? "" : Math.floor(cents / 100) + "." + String(cents % 100).padStart(2, "0");
  }

  // The cart file's columns, named so that mtgban's uploader reads them: the
  // line as the page shows it, prices in plain dollars, and the product id
  // the price list knows it by. A line the page could not read whole is
  // written with what was read.
  var CART = [
    ["Name", function (l) { return l.name; }],
    ["Edition", function (l) { return l.edition; }],
    ["Foil", function (l) { return l.foil ? "Yes" : "No"; }],
    ["Condition", function (l) { return l.condition; }],
    ["Quantity", function (l) { return l.qty; }],
    ["Price", function (l) { return decimal(l.each); }],
    ["Total", function (l) { return decimal(l.total); }],
    ["CK ID", function (l) { return l.productID; }],
  ];

  // cartCSV writes a cart's lines, as readCart reads them, in the page's order.
  CKB.cartCSV = function (lines) {
    return table(CART.map(function (column) {
      return column[0];
    }), lines.map(function (l) {
      return CART.map(function (column) {
        return column[1](l);
      });
    }));
  };

  CKB.csvColumns = function () {
    var names = [];
    for (var i = 0; i < COLUMNS.length; i++) {
      names.push(COLUMNS[i][0]);
    }
    return names;
  };
})(globalThis.CKB);
