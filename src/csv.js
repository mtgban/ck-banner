// Writes the history out as CSV.
//
// The five columns and their header are a contract: spreadsheets already
// built on this file read them by name. Every value is written as Card
// Kingdom prints it, and the file is byte for byte what Go's csv.Writer
// writes for the same rows: the same quoting, one LF per row.

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

  // toCSV writes the header and one line per history row, in the order given.
  CKB.toCSV = function (rows) {
    var lines = [row(CKB.csvColumns())];
    for (var i = 0; i < rows.length; i++) {
      var values = [];
      for (var j = 0; j < COLUMNS.length; j++) {
        values.push(rows[i][COLUMNS[j][1]]);
      }
      lines.push(row(values));
    }
    return lines.join("\n") + "\n";
  };

  CKB.csvColumns = function () {
    var names = [];
    for (var i = 0; i < COLUMNS.length; i++) {
      names.push(COLUMNS[i][0]);
    }
    return names;
  };
})(globalThis.CKB);
