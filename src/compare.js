// Compares a cart line with the price list (SPECIFICATIONS.md, section 6).
//
// The sell cart is compared with what CK's list pays (price_buy), the buy
// cart with what it asks for the line's condition. Either way the first
// matching rule wins, and the list is a snapshot: a verdict says how the
// cart stands against it, never what checkout will charge or pay.

globalThis.CKB = globalThis.CKB || {};

(function (CKB) {
  "use strict";

  // lineKey is the card a line shows, by its edition and title. The image's
  // alt text names it too, but CK cuts a long one short with "...".
  CKB.lineKey = function (line) {
    return CKB.cardKey(line.edition + ": " + line.name, line.foil);
  };

  // rowFor is the list's row for a line, or the verdict saying why there is
  // none: the row its product id names, which must be the card the line
  // shows, or, for a line with no product id (a signed-out cart), the one
  // row of that card.
  CKB.rowFor = function (line, list) {
    var key = CKB.lineKey(line);
    if (line.productID === null) {
      var found = CKB.findCard(list, key);
      return found ? { row: found } : { verdict: "unlisted" };
    }
    var row = CKB.lookup(list, line.productID);
    if (!row) {
      return { verdict: "unlisted" };
    }
    return row.name === key ? { row: row } : { verdict: "mismatch" };
  };

  // compare answers with { verdict, price, id }, price being the list's
  // price each in cents and id the line's product id wherever the line was
  // compared. seen, when given, is what CK's answers to Update price said
  // it pays now, by product id ({ buy, kept }), which outranks the list.
  //
  // Sell: unreadable, unlisted, mismatch, wants0, kept, current, better,
  //       worse, same.
  // Buy:  unreadable, unlisted, mismatch, nostock, dropped, raised, same.
  CKB.compare = function (line, list, side, seen) {
    if (line.problem) {
      return { verdict: "unreadable" };
    }
    var found = CKB.rowFor(line, list);
    if (!found.row) {
      return found;
    }
    var row = found.row;

    if (side === "sell") {
      if (row.wants === 0) {
        return { verdict: "wants0", price: row.buy, id: row.id };
      }
      var live = seen && seen[row.id];
      var pays = live ? live.buy : row.buy;
      // CK kept the line's price though it pays more: Update price cannot
      // take the new one, only removing the card and adding it again can.
      if (live && live.kept && pays > line.each) {
        return { verdict: "kept", price: pays, id: row.id };
      }
      // The line already has what CK pays now, though the list said more.
      if (live && pays !== row.buy && pays === line.each) {
        return { verdict: "current", price: pays, listed: row.buy, id: row.id };
      }
      return { verdict: pays > line.each ? "better" : pays < line.each ? "worse" : "same", price: pays, id: row.id };
    }

    var asks = row.retail[line.condition];
    if (row.stock[line.condition] === 0) {
      return { verdict: "nostock", price: asks, id: row.id };
    }
    return { verdict: asks < line.each ? "dropped" : asks > line.each ? "raised" : "same", price: asks, id: row.id };
  };
})(globalThis.CKB);
