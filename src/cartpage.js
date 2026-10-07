// Marks every line of Card Kingdom's sell cart (/sellcart) and buy cart
// (/cart) against the price list, beside the line's Save for Later.
//
// The list is read only on a click and kept for an hour (store.js); a cart
// opened while a kept list is fresh is marked at once, with no request. The
// one thing that changes a cart is Update price on a better sell line
// (update.js), one line per click, CK's answer deciding what happened.

(function (CKB) {
  "use strict";

  var SIDES = { "/sellcart": "sell", "/cart": "buy" };
  var side = SIDES[location.pathname.replace(/\/+$/, "")];
  if (!side) {
    return;
  }

  // A better line has no badge: it gets Update price (update below).
  var BADGES = {
    dropped: ["Price dropped", "good"],
    worse: ["List is lower", "warn"],
    raised: ["List is higher", "warn"],
    wants0: ["Wants 0", "warn"],
    nostock: ["None in stock", "warn"],
    same: ["✓", "quiet"],
    unlisted: ["?", "quiet"],
    mismatch: ["?", "quiet"],
    unreadable: ["?", "quiet"],
  };

  // The panel's count, in the order the spec's table gives them.
  var ORDER = {
    sell: [["better", "better"], ["worse", "worse"], ["wants0", "not wanted"], ["same", "the same"]],
    buy: [["dropped", "dropped"], ["raised", "higher"], ["nostock", "out of stock"], ["same", "the same"]],
  };
  var SKIPPED = [["unlisted", "not listed"], ["mismatch", "not matching"], ["unreadable", "unreadable"]];

  var panel = null;
  var button = null;
  var list = null;
  var reading = null;
  var shown = "";
  var store = CKB.openStore();
  // writing is an Update price in flight; locked is a cart whose state is no
  // longer known after a failed one, so no other update may be sent before
  // the page is reloaded.
  var writing = false;
  var locked = false;
  var lastSummary = null;

  CKB.reload = function () {
    location.reload();
  };

  function each(cents) {
    return CKB.dollars(cents) + " each";
  }

  function change(cents) {
    return (cents > 0 ? "+" : "") + CKB.dollars(cents);
  }

  function lineTip(line, result) {
    var p = result.price;
    var c = line.each;
    var built = " Price list built " + list.createdAt + ".";
    switch (result.verdict) {
      case "better":
        return "Card Kingdom's list now pays " + each(p) + "; the cart has " + CKB.dollars(c) + " (" +
          change(p - c) + " each, " + change((p - c) * line.qty) + " on " + line.qty + ")." + built +
          (side === "sell" ? " Update price asks Card Kingdom to reprice this line." : "");
      case "worse":
        return "Card Kingdom's list now pays " + each(p) + ", below the cart's " + CKB.dollars(c) + " (" +
          change(p - c) + " each)." + built;
      case "wants0":
        return "Card Kingdom's list wants none of this card, at " + each(p) + "." + built;
      case "dropped":
        return "Card Kingdom now asks " + each(p) + " in " + line.condition + ", below the cart's " +
          CKB.dollars(c) + " (" + change(p - c) + " each, " + change((p - c) * line.qty) + " on " + line.qty + ")." + built;
      case "raised":
        return "Card Kingdom now asks " + each(p) + " in " + line.condition + ", above the cart's " +
          CKB.dollars(c) + " (" + change(p - c) + " each)." + built;
      case "nostock":
        return "Card Kingdom's list has no " + line.condition + " copies in stock, at " + each(p) + "." + built;
      case "same":
        return "Matches Card Kingdom's list (" + each(p) + ")." + built;
      case "unlisted":
        return "Not in Card Kingdom's price list (id " + line.productID + ").";
      case "mismatch":
        return "This line's card is not the one its id names in Card Kingdom's price list, so it was not compared.";
      default:
        return "Could not read this line: " + line.problem + ".";
    }
  }

  // mark puts one line's badge and tooltip first in its Save for Later box,
  // beside the link and never inside it, replacing any mark already there.
  function mark(line, result) {
    if (!line.host) {
      return;
    }
    var old = line.host.querySelectorAll(".ck-banner-line");
    for (var i = 0; i < old.length; i++) {
      old[i].remove();
    }
    var box = document.createElement("div");
    box.className = "ck-banner-line";
    box.setAttribute("data-line", String(line.lineID));
    box.setAttribute("data-product", String(line.productID));
    box.setAttribute("data-verdict", result.verdict);

    var badge;
    if (side === "sell" && result.verdict === "better") {
      badge = document.createElement("button");
      badge.type = "button";
      // CK's own btn class, so the box's `.btn` rule draws it like Save for Later.
      badge.className = "btn ck-banner-update";
      badge.textContent = "Update price";
      badge.disabled = writing || locked;
      badge.addEventListener("click", function () {
        update(line.lineID, line.productID);
      });
    } else {
      badge = badgeOf(BADGES[result.verdict][0], BADGES[result.verdict][1]);
    }
    var tip = document.createElement("span");
    tip.className = "ck-banner-linetip";
    tip.id = "ck-banner-line-" + line.lineID;
    tip.setAttribute("role", "tooltip");
    tip.textContent = lineTip(line, result);
    badge.setAttribute("aria-describedby", tip.id);

    box.appendChild(badge);
    box.appendChild(tip);
    line.host.insertBefore(box, line.host.firstChild);
  }

  function badgeOf(text, tone) {
    var badge = document.createElement("span");
    badge.className = "ck-banner-badge ck-banner-" + tone;
    badge.tabIndex = 0;
    badge.textContent = text;
    return badge;
  }

  // swap replaces a line's control with a badge, and says why on its tooltip.
  function swap(box, text, tone, tip) {
    var control = box.querySelector(".ck-banner-badge, .ck-banner-update");
    var badge = badgeOf(text, tone);
    badge.setAttribute("aria-describedby", control.getAttribute("aria-describedby"));
    control.replaceWith(badge);
    box.querySelector(".ck-banner-linetip").textContent = tip;
  }

  function updates(disabled) {
    var all = document.querySelectorAll(".ck-banner-update");
    for (var i = 0; i < all.length; i++) {
      all[i].disabled = disabled || locked;
    }
  }

  // update sends the one request for the line its control was made for,
  // once the line is still that line, still better, and the list still
  // fresh; otherwise it asks for a new check and sends nothing.
  function update(lineID, productID) {
    if (writing || locked || reading) {
      return;
    }
    var line = CKB.readCart(document, location.href, side).filter(function (l) {
      return l.lineID === lineID && l.productID === productID;
    })[0];
    var box = document.querySelector('.ck-banner-line[data-line="' + lineID + '"]');
    if (!CKB.fresh(list, Date.now())) {
      swap(box, "Check again", "warn", "The price list is over an hour old; check prices again before updating.");
      return;
    }
    if (!line || CKB.compare(line, list, side).verdict !== "better") {
      swap(box, "Check again", "warn", "This line changed since it was marked; check prices again.");
      return;
    }

    var listed = CKB.compare(line, list, side).price;
    writing = true;
    updates(true);
    box.querySelector(".ck-banner-update").textContent = "Updating";
    panel.clear();
    panel.word("updating");
    panel.busy(true);
    CKB.updatePrice(line).then(function (answer) {
      answered(line, box, listed, answer);
    });
  }

  function answered(line, box, listed, answer) {
    if (answer.outcome === "repriced") {
      var note = answer.price !== listed ? ", not the " + CKB.dollars(listed) + " its list showed" : "";
      swap(box, "Updated", "good", "Card Kingdom now pays " + each(answer.price) + note + ".");
      panel.word("updated");
      panel.mark("done");
      // Reloaded so the cart shows CK's own figures; nothing else is sent.
      setTimeout(function () {
        panel.busy(false);
        CKB.reload();
      }, 800);
      return;
    }
    if (answer.outcome === "quantity") {
      swap(box, "Quantity changed", "bad", "Card Kingdom set the quantity to " + answer.qty + "; putting it back to " + line.qty + ".");
      panel.word("restoring");
      CKB.restoreQuantity(line, answer.lineID, line.qty).then(function () {
        panel.busy(false);
        CKB.reload();
      });
      return;
    }

    writing = false;
    panel.busy(false);
    if (answer.outcome === "kept") {
      swap(box, "Price kept", "warn", "Card Kingdom kept " + each(answer.price) + ". Remove the card and add it again to take " +
        each(answer.buy) + ".");
      updates(false);
      lastSummary();
      return;
    }
    locked = true;
    updates(true);
    swap(box, "Not updated", "bad", answer.message + ". Reload the page to see what Card Kingdom holds.");
    lastSummary();
    panel.fail(answer.message + ". Reload the page to see what Card Kingdom holds; no other update will be sent until then.");
  }

  function signature(lines) {
    return lines
      .map(function (l) {
        return [l.lineID, l.productID, l.qty, l.each, l.condition].join(":");
      })
      .join("|");
  }

  function clock(ms) {
    var at = new Date(ms);
    return String(at.getHours()).padStart(2, "0") + ":" + String(at.getMinutes()).padStart(2, "0");
  }

  // summary is the panel's count and its tooltip: every verdict by name,
  // what the better (or dropped) lines come to, and how old the list is.
  function summary(lines, counts, gain, lasting) {
    var key = ORDER[side][0][0];
    panel.word(counts[key] ? counts[key] + " " + ORDER[side][0][1] : "none " + ORDER[side][0][1]);
    panel.mark("done");

    var said = [];
    ORDER[side].concat(SKIPPED).forEach(function (pair) {
      if (counts[pair[0]]) {
        said.push(counts[pair[0]] + " " + pair[1]);
      }
    });
    var text = said.join(", ") + ".";
    if (gain) {
      text += side === "sell"
        ? " Every better price would add " + CKB.dollars(gain) + "."
        : " The drops come to " + CKB.dollars(-gain) + " off the cart.";
    }
    text += " Price list built " + list.createdAt + ", read at " + clock(list.fetchedAt) + ".";
    if (!lasting) {
      text += " It is kept for this page only: this browser does not let the site store it.";
    }
    var subtotal = CKB.cartSubtotal(document);
    var total = lines.reduce(function (sum, l) {
      return sum + (l.total || 0);
    }, 0);
    if (subtotal !== null && subtotal !== total) {
      text += " The lines read come to " + CKB.dollars(total) + " of the cart's " + CKB.dollars(subtotal) +
        " Subtotal, so a line may not have been read.";
    }
    panel.recap(text);
  }

  function annotate(lasting) {
    var lines = CKB.readCart(document, location.href, side);
    var counts = {};
    var gain = 0;
    lines.forEach(function (line) {
      var result = CKB.compare(line, list, side);
      mark(line, result);
      counts[result.verdict] = (counts[result.verdict] || 0) + 1;
      if (result.verdict === "better" || result.verdict === "dropped") {
        gain += (result.price - line.each) * line.qty;
      }
    });
    shown = signature(lines);
    lastSummary = function () {
      summary(lines, counts, gain, lasting);
    };
    lastSummary();
    button.textContent = "Refresh";
  }

  function marked(lines) {
    return lines.every(function (l) {
      return !l.host || l.host.querySelector('.ck-banner-line[data-line="' + l.lineID + '"]');
    });
  }

  function idle() {
    panel.word("prices");
    panel.clear();
    panel.hint("Compare this cart with Card Kingdom's price list, read once and kept for an hour");
  }

  function check() {
    if (writing) {
      return;
    }
    var controller = new AbortController();
    reading = controller;
    panel.clear();
    panel.word("reading list");
    panel.busy(true);
    CKB.fetchList({ signal: controller.signal })
      .then(function (fetched) {
        if (reading !== controller) {
          return null;
        }
        reading = null;
        list = fetched;
        panel.busy(false);
        return store.then(function (s) {
          annotate(s.lasting);
          return CKB.keepList(s, fetched).catch(function () {});
        });
      })
      .catch(function (err) {
        // A read Escape cancelled has nothing to say.
        if (reading !== controller) {
          return;
        }
        reading = null;
        panel.busy(false);
        restore().then(function () {
          panel.fail(err && err.message ? err.message : String(err));
        });
      });
  }

  // restore puts the panel back as it was before a read: marked from the
  // list in hand, or waiting for a first one.
  function restore() {
    if (!list) {
      idle();
      return Promise.resolve();
    }
    return store.then(function (s) {
      annotate(s.lasting);
    });
  }

  function cancel() {
    if (!reading) {
      return;
    }
    reading.abort();
    reading = null;
    panel.busy(false);
    restore();
  }

  // refresh re-marks the cart when its lines changed, or when the page
  // redrew a line and took its mark with it; its own marks change neither.
  function refresh() {
    var lines = CKB.readCart(document, location.href, side);
    panel.root.hidden = !lines.length;
    if (!list || reading || writing || (signature(lines) === shown && marked(lines))) {
      return;
    }
    store.then(function (s) {
      annotate(s.lasting);
    });
  }

  function install() {
    if (document.getElementById("ck-banner")) {
      return;
    }
    panel = CKB.panel();
    button = document.createElement("button");
    button.type = "button";
    button.className = "ck-banner-go";
    button.textContent = "Check prices";
    button.addEventListener("click", check);
    panel.actions.appendChild(button);
    panel.root.hidden = !CKB.readCart(document, location.href, side).length;
    document.body.appendChild(panel.root);
    idle();

    store
      .then(function (s) {
        return CKB.keptList(s, Date.now()).then(function (kept) {
          if (kept && !list && !reading) {
            list = kept;
            annotate(s.lasting);
          }
        });
      })
      .catch(function () {});

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        cancel();
      }
    });

    var pending = null;
    new MutationObserver(function () {
      if (pending !== null) {
        return;
      }
      pending = setTimeout(function () {
        pending = null;
        refresh();
      }, 300);
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install);
  } else {
    install();
  }
})(globalThis.CKB);
