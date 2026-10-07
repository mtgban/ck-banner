// Reads the money and dates Card Kingdom prints.
//
// Both are read by shape and arithmetic, never by parseFloat or Date.parse:
// those accept what the page should not be trusted to print ("$1.234", a
// locale's own date order), and a value read wrong is worse than one refused.

globalThis.CKB = globalThis.CKB || {};

(function (CKB) {
  "use strict";

  // "$1,234.56" or "$0.02": dollars, grouped or not, and exactly two cents.
  var MONEY = /^\$([1-9]\d{0,2}(?:,\d{3})+|\d+)\.(\d{2})$/;

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // "Mar 14, 2026 10:36 AM" or "Mar 5, 2026". Days are not padded, hours are.
  var WHEN = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})(?: (\d{1,2}):(\d{2}) ([AP]M))?$/;

  function daysIn(year, month) {
    if (month === 2) {
      return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
    }
    return [4, 6, 9, 11].indexOf(month) >= 0 ? 30 : 31;
  }

  // cents reads "$1,234.56" as 123456, and answers null for any other shape.
  CKB.cents = function (text) {
    var m = MONEY.exec(String(text).trim());
    if (!m) {
      return null;
    }
    return Number(m[1].replace(/,/g, "")) * 100 + Number(m[2]);
  };

  // dollars writes cents the way Card Kingdom prints them, with a leading
  // minus for a difference that goes down.
  CKB.dollars = function (cents) {
    var sign = cents < 0 ? "-" : "";
    var abs = Math.abs(cents);
    var whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+$)/g, ",");
    return sign + "$" + whole + "." + String(abs % 100).padStart(2, "0");
  };

  // when reads a date into {year, month, day, hour, minute}, hour and minute
  // null when it carries no time, and answers null for any other shape or a
  // day the month does not have.
  CKB.when = function (text) {
    var m = WHEN.exec(String(text).trim().replace(/\s+/g, " "));
    if (!m) {
      return null;
    }
    var year = Number(m[3]);
    var month = MONTHS.indexOf(m[1]) + 1;
    var day = Number(m[2]);
    if (month === 0 || day < 1 || day > daysIn(year, month)) {
      return null;
    }
    var parts = { year: year, month: month, day: day, hour: null, minute: null };
    if (m[4] !== undefined) {
      var hour = Number(m[4]);
      var minute = Number(m[5]);
      if (hour < 1 || hour > 12 || minute > 59) {
        return null;
      }
      // 12 AM is midnight and 12 PM is noon.
      parts.hour = (hour % 12) + (m[6] === "PM" ? 12 : 0);
      parts.minute = minute;
    }
    return parts;
  };
})(globalThis.CKB);
