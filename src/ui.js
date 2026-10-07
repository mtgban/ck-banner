// The panel both pages share: a heading (the stroopwafel, "CK BANner", one
// word, a mark) with a tooltip the panel draws itself, over one row of
// controls. It is a fixed width, and nothing is ever written under the row:
// what a finished or failed piece of work has to say goes on the tooltip.

globalThis.CKB = globalThis.CKB || {};

(function (CKB) {
  "use strict";

  // hold asks the browser to confirm before the page goes anywhere, which
  // would take a running read with it. The wording is the browser's own.
  function hold(event) {
    event.preventDefault();
    event.returnValue = "";
    return "";
  }

  // panel builds the box and answers with what changes it. Nothing is on
  // the page until the caller appends root.
  CKB.panel = function () {
    var root = document.createElement("div");
    root.id = "ck-banner";
    root.innerHTML =
      '<div class="ck-banner-label" tabindex="0" aria-describedby="ck-banner-tip">' +
      'CK BAN<i class="ck-banner-ner">ner</i> - ' +
      '<span class="ck-banner-spin" aria-hidden="true"></span>' +
      '<b class="ck-banner-word"></b>' +
      '<span class="ck-banner-mark" aria-hidden="true" hidden></span>' +
      "</div>" +
      '<span class="ck-banner-tip" id="ck-banner-tip" role="tooltip"></span>' +
      '<div class="ck-banner-actions"></div>';

    var hinted = "";
    var recapped = "";

    function at(selector) {
      return root.querySelector(selector);
    }

    function working() {
      return root.classList.contains("ck-banner-busy");
    }

    // One tooltip: what the last piece of work said while that stands, or
    // else what the panel offers. Quiet while work runs, since the heading
    // holds the progress then.
    function tip() {
      at(".ck-banner-tip").textContent = recapped || (working() ? "" : hinted);
    }

    var panel = {
      root: root,
      actions: at(".ck-banner-actions"),

      word: function (text) {
        at(".ck-banner-word").textContent = text;
      },

      hint: function (text) {
        hinted = text;
        tip();
      },

      recap: function (text) {
        recapped = text;
        tip();
      },

      // mark is the sign beside the word: "done" a tick, "failed" a red
      // cross, "" neither.
      mark: function (how) {
        var sign = at(".ck-banner-mark");
        sign.hidden = !how;
        sign.textContent = how === "failed" ? "✗" : "✓";
        sign.classList.toggle("ck-banner-failed", how === "failed");
      },

      fail: function (message) {
        panel.mark("failed");
        panel.recap(message);
      },

      clear: function () {
        panel.mark("");
        panel.recap("");
      },

      // busy turns the spinner on, takes every control in the row away,
      // and holds the page, for as long as work runs.
      busy: function (on) {
        root.classList.toggle("ck-banner-busy", on);
        var controls = panel.actions.querySelectorAll("button, select");
        for (var i = 0; i < controls.length; i++) {
          controls[i].disabled = on;
        }
        if (on) {
          window.addEventListener("beforeunload", hold);
        } else {
          window.removeEventListener("beforeunload", hold);
        }
        tip();
      },

      working: working,
    };
    return panel;
  };

  // download hands text to the browser as a file.
  CKB.download = function (text, filename, type) {
    var blob = new Blob([text], { type: type || "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Firefox needs the object to outlive the click it was made for.
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 30000);
  };
})(globalThis.CKB);
