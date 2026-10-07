// Compares a cart line with the price list (SPECIFICATIONS.md, section 6).
//
// The sell cart is compared with what CK's list pays (price_buy), the buy
// cart with what it asks for the line's condition. Either way the first
// matching rule wins, and the list is a snapshot: a verdict says how the
// cart stands against it, never what checkout will charge or pay.

globalThis.CKB = globalThis.CKB || {};

(function (CKB) {
  "use strict";

  // compare answers with { verdict, price }, price being the list's price
  // each in cents wherever the line was compared.
  //
  // Sell: unreadable, unlisted, mismatch, wants0, better, worse, same.
  // Buy:  unreadable, unlisted, mismatch, nostock, dropped, raised, same.
  CKB.compare = function (line, list, side) {
    if (line.problem) {
      return { verdict: "unreadable" };
    }
    var row = CKB.lookup(list, line.productID);
    if (!row) {
      return { verdict: "unlisted" };
    }
    // The id must point at the card the line shows.
    if (row.name !== CKB.nameKey(line.alt)) {
      return { verdict: "mismatch" };
    }

    if (side === "sell") {
      if (row.wants === 0) {
        return { verdict: "wants0", price: row.buy };
      }
      var pays = row.buy;
      return { verdict: pays > line.each ? "better" : pays < line.each ? "worse" : "same", price: pays };
    }

    var asks = row.retail[line.condition];
    if (row.stock[line.condition] === 0) {
      return { verdict: "nostock", price: asks };
    }
    return { verdict: asks < line.each ? "dropped" : asks > line.each ? "raised" : "same", price: asks };
  };
})(globalThis.CKB);
