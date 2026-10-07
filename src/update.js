// Asks Card Kingdom to reprice one sell cart line (SPECIFICATIONS.md,
// section 7).
//
// The request is the one go-mtgban's cart client sends, for the line's own
// quantity. What it does to a line already in the cart is not known, so the
// cached list never decides the outcome: CK's answer, which is the whole
// cart, does.

globalThis.CKB = globalThis.CKB || {};

(function (CKB) {
  "use strict";

  CKB.SELL_ADD = "https://www.cardkingdom.com/api/sellcart/add";

  function failed(message) {
    return { outcome: "failed", message: message };
  }

  // readAnswer finds the line in CK's answer: the one NM line for the
  // product, its quantity, its price and the product's current buy price.
  function readAnswer(cart, line) {
    var items = cart && Array.isArray(cart.lineitems) ? cart.lineitems : null;
    if (!items) {
      return failed("Card Kingdom's answer could not be read");
    }
    var mine = items.filter(function (item) {
      return item && String(item.product_id) === String(line.productID) && item.style === "NM";
    });
    if (mine.length !== 1) {
      return failed(mine.length ? "Card Kingdom's answer holds this card twice" : "Card Kingdom's answer has no line for this card");
    }
    var item = mine[0];
    var price = CKB.listCents(item.price);
    var buy = CKB.listCents(item.product && item.product.price_buy);
    if (typeof item.qty !== "number" || typeof item.id !== "number" || price === null || buy === null) {
      return failed("Card Kingdom's answer could not be read");
    }
    var read = { lineID: item.id, qty: item.qty, price: price, buy: buy };
    if (item.qty !== line.qty) {
      read.outcome = "quantity";
    } else {
      read.outcome = price === buy ? "repriced" : "kept";
    }
    return read;
  }

  // updatePrice sends the one request for line and answers with CK's
  // outcome: repriced (its quantity, at the product's current buy price),
  // kept (its quantity, at the old price), quantity (CK set another, in
  // qty) or failed (message says why). It never rejects.
  CKB.updatePrice = function (line) {
    return fetch(CKB.SELL_ADD, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ product_id: String(line.productID), style: "NM", quantity: line.qty }),
      signal: CKB.deadline(),
    }).then(
      function (response) {
        if (!response.ok) {
          return failed("Card Kingdom answered " + response.status);
        }
        return response.json().then(
          function (cart) {
            return readAnswer(cart, line);
          },
          function () {
            return failed("Card Kingdom's answer could not be read");
          }
        );
      },
      function (err) {
        return failed(err && err.name === "TimeoutError" ? CKB.TIMED_OUT : "The request did not reach Card Kingdom");
      }
    );
  };

  // restoreQuantity puts a line back to qty the way the cart page does: its
  // own quantity form, posted with an absolute quantity and the form's token,
  // to the line CK now holds. It answers with whether CK took it.
  CKB.restoreQuantity = function (line, lineID, qty) {
    var token = line.form.querySelector('input[name="_token"]');
    var params = new URLSearchParams();
    params.set("_token", token ? token.value : "");
    params.set("qty", String(qty));
    return fetch(new URL("/sellcart/lineitem/" + lineID, location.href).href, {
      method: "POST",
      credentials: "same-origin",
      body: params,
      signal: CKB.deadline(),
    }).then(
      function (response) {
        return response.ok;
      },
      function () {
        return false;
      }
    );
  };
})(globalThis.CKB);
