// Marks every line of Card Kingdom's sell cart (/sellcart) and buy cart
// (/cart) against the price list, beside the line's Save for Later.
//
// The list is read only on a click and kept for an hour (store.js); a cart
// opened while a kept list is fresh is marked at once, with no request. The
// one thing that changes a cart is Update price on a better sell line
// (update.js), CK's answer deciding what happened: one line per click, or
// every better line in turn from Update all, under Empty Cart.

(function (CKB) {
  "use strict";

  var SIDES = { "/sellcart": "sell", "/cart": "buy" };
  var side = SIDES[location.pathname.replace(/\/+$/, "")];
  if (!side) {
    return;
  }

  // A better sell line gets Update price instead (update below), and a line
  // the list agrees with gets no mark at all.
  var BADGES = {
    dropped: ["Price dropped", "good"],
    worse: ["Keep price", "warn"],
    raised: ["Price went up", "warn"],
    wants0: ["Wants 0", "warn"],
    nostock: ["None in stock", "warn"],
    unlisted: ["?", "quiet"],
    mismatch: ["?", "quiet"],
    unreadable: ["?", "quiet"],
  };

  // The panel's count, in the order the spec's table gives them, in the
  // same words on both carts: better is the side that favours the visitor.
  var ORDER = {
    sell: [["better", "better"], ["worse", "worse"], ["wants0", "not wanted"], ["same", "the same"]],
    buy: [["dropped", "better"], ["raised", "worse"], ["nostock", "out of stock"], ["same", "the same"]],
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
  // wanted is the lines the last marking gave a mark, by line id.
  var wanted = {};
  var expiry = null;
  // all is the Update all control the last marking placed, if any; run is
  // an Update all under way; jumped is the line the heading last went to.
  var all = null;
  var run = null;
  var jumped = -1;

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
    var p = CKB.dollars(result.price);
    var c = CKB.dollars(line.each);
    var by = " (" + change(result.price - line.each) + " each)";
    switch (result.verdict) {
      case "better":
      case "worse":
        return "Buylist currently pays " + p + ".";
      case "wants0":
        return "List wants none, at " + p + ".";
      case "dropped":
      case "raised":
        return "List asks " + p + " in " + line.condition + ", cart has " + c + by + ".";
      case "nostock":
        return "List has no " + line.condition + " in stock, at " + p + ".";
      case "unlisted":
        return "Not in the price list.";
      case "mismatch":
        return "Could not match this card to the price list (id " + line.productID + ").";
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
    if (result.verdict === "same") {
      return;
    }
    // The box lays its controls out in one row, the mark left of the link.
    line.host.classList.add("ck-banner-host");
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
    var controls = document.querySelectorAll(".ck-banner-update, .ck-banner-update-all");
    for (var i = 0; i < controls.length; i++) {
      controls[i].disabled = disabled || locked;
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

    writing = true;
    updates(true);
    box.querySelector(".ck-banner-update").textContent = "Updating";
    panel.clear();
    panel.jump(null);
    panel.word("updating");
    panel.busy(true);
    CKB.updatePrice(line).then(function (answer) {
      answered(line, box, answer);
    });
  }

  function answered(line, box, answer) {
    // Both of these end in a reload, so the line stays "Updating", and the
    // panel busy, until the cart shows CK's own figures; nothing else is sent.
    if (answer.outcome === "repriced") {
      panel.release();
      CKB.reload();
      return;
    }
    if (answer.outcome === "quantity") {
      CKB.restoreQuantity(line, answer.lineID, line.qty).then(function (restored) {
        if (!restored) {
          refused(box, "Card Kingdom set this line to " + answer.qty + ", and putting back " + line.qty + " failed");
          return;
        }
        panel.release();
        CKB.reload();
      });
      return;
    }
    if (answer.outcome !== "kept") {
      refused(box, answer.message);
      return;
    }

    writing = false;
    panel.busy(false);
    kept(box, answer);
    updates(false);
    placeAll();
    lastSummary();
  }

  function kept(box, answer) {
    swap(box, "Price kept", "warn", "Card Kingdom kept " + each(answer.price) + ". Remove the card and add it again to take " +
      each(answer.buy) + ".");
  }

  // refused marks the line "Not updated" and sends nothing more until the
  // page is reloaded, since the cart may no longer be what the page shows.
  function refused(box, message) {
    writing = false;
    run = null;
    panel.busy(false);
    locked = true;
    updates(true);
    swap(box, "Not updated", "bad", message + ". Reload the page to see what Card Kingdom holds.");
    lastSummary();
    panel.fail(message + ". Reload the page to see what Card Kingdom holds; no other update will be sent until then.");
  }

  // updateAll sends Update price's request for every line the list pays
  // more for, top to bottom, one at a time and paced, and stops at the first
  // that fails. Escape stops it once the request in flight is answered. A
  // cart CK changed is reloaded at the end.
  function updateAll() {
    if (writing || locked || reading) {
      return;
    }
    if (!CKB.fresh(list, Date.now())) {
      panel.fail("The price list is over an hour old; load prices again before updating.");
      return;
    }
    var lines = CKB.readCart(document, location.href, side).filter(function (l) {
      return CKB.compare(l, list, side).verdict === "better" &&
        document.querySelector('.ck-banner-line[data-line="' + l.lineID + '"] .ck-banner-update');
    });
    if (!lines.length) {
      return;
    }
    writing = true;
    run = { stopped: false, changed: false };
    updates(true);
    all.querySelector("button").textContent = "Updating";
    panel.clear();
    panel.jump(null);
    panel.busy(true);
    send(lines, 0);
  }

  function send(lines, i) {
    if (i >= lines.length || run.stopped) {
      ran();
      return;
    }
    var line = lines[i];
    var box = document.querySelector('.ck-banner-line[data-line="' + line.lineID + '"]');
    panel.word("updating " + (i + 1) + " of " + lines.length);
    CKB.after(i ? CKB.PACE : 0)
      .then(function () {
        if (run.stopped) {
          return null;
        }
        box.querySelector(".ck-banner-update").textContent = "Updating";
        return CKB.updatePrice(line);
      })
      .then(function (answer) {
        if (!answer) {
          ran();
        } else if (answer.outcome === "repriced") {
          run.changed = true;
          swap(box, "Updated", "good", "Card Kingdom now pays " + each(answer.buy) + ".");
          send(lines, i + 1);
        } else if (answer.outcome === "kept") {
          kept(box, answer);
          send(lines, i + 1);
        } else if (answer.outcome === "quantity") {
          run.changed = true;
          CKB.restoreQuantity(line, answer.lineID, line.qty).then(function (restored) {
            if (!restored) {
              refused(box, "Card Kingdom set this line to " + answer.qty + ", and putting back " + line.qty + " failed");
              return;
            }
            swap(box, "Updated", "warn", "Card Kingdom set this line to " + answer.qty + "; it was put back to " + line.qty + ".");
            send(lines, i + 1);
          });
        } else {
          refused(box, answer.message);
        }
      });
  }

  // ran ends an Update all that was not refused: with a reload when CK
  // changed the cart, so it shows CK's own figures, or else as it stands.
  function ran() {
    if (run.changed) {
      panel.release();
      CKB.reload();
      return;
    }
    writing = false;
    run = null;
    panel.busy(false);
    updates(false);
    placeAll();
    lastSummary();
  }

  // placeAll puts Update all under the sidebar's Empty Cart once the cart is
  // marked, in CK's own button style: counting the lines that offer Update
  // price, or greyed out, its tooltip saying why, when none does.
  function placeAll() {
    if (all) {
      all.remove();
      all = null;
    }
    var n = document.querySelectorAll(".ck-banner-update").length;
    var empty = document.querySelector('form[action$="/sellcart/empty_cart"]');
    var slot = empty && empty.closest(".cart-button-padding");
    if (!slot) {
      return;
    }
    all = document.createElement("div");
    all.className = "cart-button-padding ck-banner-all";
    all.innerHTML = '<div class="btn-group-justified"><div class="btn-group">' +
      '<button type="button" class="btn btn-default ck-banner-update-all"></button></div></div>';
    var control = all.querySelector("button");
    if (!n) {
      // Greyed rather than disabled, so its tooltip shows on hover and focus.
      control.textContent = "Update prices";
      control.classList.add("disabled");
      control.setAttribute("aria-disabled", "true");
      control.setAttribute("aria-describedby", "ck-banner-alltip");
      var tip = document.createElement("span");
      tip.className = "ck-banner-alltip";
      tip.id = "ck-banner-alltip";
      tip.setAttribute("role", "tooltip");
      tip.textContent = "All the best prices are already in the cart.";
      all.appendChild(tip);
    } else {
      control.textContent = "Update " + n + (n === 1 ? " price" : " prices");
      control.disabled = writing || locked;
      control.addEventListener("click", updateAll);
    }
    slot.after(all);
  }

  // next takes the page to the next line the list favours, after the one
  // it went to last and round again, and focuses its control.
  function next() {
    var boxes = document.querySelectorAll('.ck-banner-line[data-verdict="' + ORDER[side][0][0] + '"]');
    if (!boxes.length) {
      return;
    }
    jumped = (jumped + 1) % boxes.length;
    boxes[jumped].scrollIntoView({ block: "center" });
    boxes[jumped].querySelector(".ck-banner-update, .ck-banner-badge").focus({ preventScroll: true });
  }

  function signature(lines) {
    return lines
      .map(function (l) {
        return [l.lineID, l.productID, l.qty, l.each, l.condition].join(":");
      })
      .join("|");
  }

  // summary is the panel's count and its tooltip: how many lines the list
  // now favours, every verdict by name, and when the list was built, with
  // how many of its rows could not be read when any could not.
  function summary(counts) {
    var key = ORDER[side][0][0];
    panel.word(counts[key] ? counts[key] + " " + ORDER[side][0][1] : "ready");
    panel.mark("done");
    panel.jump(counts[key] ? next : null);
    refreshable();

    // "2 prices are the same", then when the list is from, on its own line.
    var said = [];
    ORDER[side].concat(SKIPPED).forEach(function (pair) {
      var n = counts[pair[0]];
      if (n) {
        said.push(said.length ? n + " " + pair[1] : n + (n === 1 ? " price is " : " prices are ") + pair[1]);
      }
    });
    var built = "Price list of " + list.createdAt.replace(/:\d\d$/, "");
    if (list.skipped > 0) {
      built += " (" + list.skipped + (list.skipped === 1 ? " row" : " rows") + " unreadable)";
    }
    panel.recap(said.join(", ") + "\n" + built);
  }

  // refreshable greys Refresh out while the list in hand is fresh, since
  // reading it again would change nothing, and brings it back as it ages.
  function refreshable() {
    var left = list ? list.fetchedAt + CKB.LIST_TTL - Date.now() : 0;
    button.disabled = left > 0;
    clearTimeout(expiry);
    if (left > 0) {
      expiry = setTimeout(refreshable, left);
    }
  }

  function annotate() {
    var lines = CKB.readCart(document, location.href, side);
    var counts = {};
    wanted = {};
    lines.forEach(function (line) {
      var result = CKB.compare(line, list, side);
      mark(line, result);
      counts[result.verdict] = (counts[result.verdict] || 0) + 1;
      if (result.verdict !== "same") {
        wanted[line.lineID] = true;
      }
    });
    shown = signature(lines);
    jumped = -1;
    placeAll();
    lastSummary = function () {
      summary(counts);
    };
    lastSummary();
    button.textContent = "Refresh";
  }

  // marked says whether every line the last marking marked still has it.
  function marked(lines) {
    return (!all || document.contains(all)) && lines.every(function (l) {
      return !wanted[l.lineID] || !l.host || l.host.querySelector('.ck-banner-line[data-line="' + l.lineID + '"]');
    });
  }

  function idle() {
    panel.jump(null);
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
    panel.jump(null);
    panel.word("fetching prices");
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
          annotate();
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
      annotate();
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
      annotate();
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
    button.textContent = "Load prices";
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
            annotate();
          }
        });
      })
      .catch(function () {});

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        cancel();
        if (run) {
          run.stopped = true;
        }
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
