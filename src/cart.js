// Reads Card Kingdom's carts: the sell cart (/sellcart) and the buy cart
// (/cart). The two share their markup but for three things, in SIDES.
//
// A line is a .cart-item-wrapper holding its own quantity form, the one
// that posts to /sellcart/lineitem/<id> or /cart/lineitem/<id>. That form,
// not a product id, is what makes a wrapper a line: the Saved For Later list
// under the sell cart is the purchase side, and its Move All To Cart button
// carries a product id of its own. Every field comes from the line's own
// wrapper, and a line that cannot be read whole is kept with the reason
// rather than dropped.

globalThis.CKB = globalThis.CKB || {};

(function (CKB) {
  "use strict";

  // The quantity form's path, and how the price each is printed: "$6.00 /ea"
  // on the sell cart, "($6.00 /ea)" on the buy cart, whose line total sits in
  // its own span and whose lines each carry a condition.
  var SIDES = {
    sell: { form: /^\/sellcart\/lineitem\/(\d+)$/, each: /^(\$[\d,]+\.\d{2}) \/ea$/ },
    buy: { form: /^\/cart\/lineitem\/(\d+)$/, each: /^\((\$[\d,]+\.\d{2}) \/ea\)$/ },
  };

  var CONDITIONS = ["NM", "EX", "VG", "G"];
  var SUBTOTAL = /^Subtotal: (\$[\d,]+\.\d{2})$/;

  function text(node) {
    return node ? node.textContent.replace(/\s+/g, " ").trim() : "";
  }

  // firstText is the line total, the text ahead of the price-each below it.
  function firstText(node) {
    for (var i = 0; i < node.childNodes.length; i++) {
      if (node.childNodes[i].nodeType === 3 && node.childNodes[i].textContent.trim()) {
        return node.childNodes[i].textContent.trim();
      }
    }
    return "";
  }

  // lineForm is the wrapper's quantity form and the line id it posts to.
  // Actions are written both relative and absolute, so each is resolved
  // against the page and must stay on its origin.
  function lineForm(wrapper, base, side) {
    var forms = wrapper.querySelectorAll("form[action]");
    for (var i = 0; i < forms.length; i++) {
      var url;
      try {
        url = new URL(forms[i].getAttribute("action"), base);
      } catch (err) {
        continue;
      }
      var m = side.form.exec(url.pathname);
      if (m && url.origin === base.origin) {
        return { form: forms[i], id: Number(m[1]) };
      }
    }
    return null;
  }

  function readLine(wrapper, found, side) {
    var link = wrapper.querySelector(".save-for-later-button a[data-ckproductid]");
    var id = link ? link.getAttribute("data-ckproductid") : "";
    var qty = found.form.querySelector('input[name="qty"]');
    var price = wrapper.querySelector(".item-price-wrapper");
    var each = SIDES[side].each.exec(text(price && price.querySelector("small")));
    var total = price && (side === "buy" ? text(price.querySelector(".cart-item-price")) : firstText(price));
    var img = wrapper.querySelector("img[alt]");
    // The sell cart buys near mint only; the buy cart names each line's.
    var condition = side === "buy" ? text(wrapper.querySelector(".style")) : "NM";

    var line = {
      wrapper: wrapper,
      form: found.form,
      host: wrapper.querySelector(".save-for-later-button"),
      lineID: found.id,
      productID: /^\d+$/.test(id) ? Number(id) : null,
      qty: qty && /^[1-9]\d*$/.test(qty.value) ? Number(qty.value) : null,
      each: each ? CKB.cents(each[1]) : null,
      total: total ? CKB.cents(total) : null,
      condition: CONDITIONS.indexOf(condition) >= 0 ? condition : null,
      alt: img ? img.getAttribute("alt").trim() : "",
      problem: "",
    };
    if (line.productID === null) {
      line.problem = "no product id";
    } else if (line.qty === null) {
      line.problem = "no quantity";
    } else if (line.each === null || line.total === null) {
      line.problem = "no price";
    } else if (line.total !== line.qty * line.each) {
      line.problem = "its total is not its quantity times its price";
    } else if (!line.alt) {
      line.problem = "no card name";
    } else if (line.condition === null) {
      line.problem = "no condition";
    }
    return line;
  }

  // readCart reads every line of the "sell" or "buy" cart on the page, in
  // the page's order. href is the page's own address, which relative form
  // actions resolve against.
  CKB.readCart = function (doc, href, side) {
    if (!SIDES[side]) {
      throw new Error("Unknown cart: " + side);
    }
    var base = new URL(href);
    var wrappers = doc.querySelectorAll(".cart-item-wrapper");
    var lines = [];
    for (var i = 0; i < wrappers.length; i++) {
      var found = lineForm(wrappers[i], base, SIDES[side]);
      if (!found) {
        continue;
      }
      lines.push(readLine(wrappers[i], found, side));
    }
    return lines;
  };

  // cartSubtotal is the header's Subtotal in cents, or null when the page
  // does not print one: the sum the lines' totals must come to.
  CKB.cartSubtotal = function (doc) {
    var m = SUBTOTAL.exec(text(doc.querySelector(".header-subtotal")));
    return m ? CKB.cents(m[1]) : null;
  };
})(globalThis.CKB);
