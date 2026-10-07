// Asks Card Kingdom for its own pages, one at a time and slowly.
//
// www.cardkingdom.com sits behind Cloudflare, which reads a burst of fetches
// as a bot and answers with a challenge meant for a person. So nothing here
// fans out, and a challenge stops the work instead of being retried: nothing
// an extension sends can answer it.

globalThis.CKB = globalThis.CKB || {};

(function (CKB) {
  "use strict";

  // PACE is the pause before each page after the first. It is cm-banner's
  // figure for Cardmarket, where three requests inside a second drew a
  // challenge; a full sales walk on the live site decides it for 0.1.0.
  var PACE = 1200;

  // TIMEOUT bounds one page, so a connection that goes quiet fails the read
  // instead of leaving the spinner turning.
  var TIMEOUT = 30000;

  CKB.CHALLENGE = "Card Kingdom is checking the browser; reload and try again";
  CKB.TIMED_OUT = "Card Kingdom did not answer in time";

  // deadline is a signal that aborts after ms, TIMEOUT by default, where the
  // browser has AbortSignal.timeout.
  function deadline(ms) {
    if (typeof AbortSignal === "undefined" || !AbortSignal.timeout) {
      return undefined;
    }
    return AbortSignal.timeout(ms || TIMEOUT);
  }

  // challenged tells a Cloudflare challenge from an ordinary refusal: both
  // can be a 403 or a 429, and only the challenge carries this header.
  function challenged(response) {
    return response.headers.get("cf-mitigated") === "challenge";
  }

  function after(ms) {
    if (!ms) {
      return Promise.resolve();
    }
    return new Promise(function (resume) {
      setTimeout(resume, ms);
    });
  }

  // fetchPage reads one of this origin's pages with the visitor's own
  // session, and answers with it parsed.
  function fetchPage(url) {
    return fetch(url, {
      credentials: "same-origin",
      signal: deadline(),
      headers: { Accept: "text/html,application/xhtml+xml" },
    })
      .then(function (response) {
        if (challenged(response)) {
          throw new Error(CKB.CHALLENGE);
        }
        if (!response.ok) {
          throw new Error("Card Kingdom answered " + response.status);
        }
        return response.text();
      })
      .then(function (text) {
        return new DOMParser().parseFromString(text, "text/html");
      })
      .catch(function (err) {
        if (err && err.name === "TimeoutError") {
          throw new Error(CKB.TIMED_OUT);
        }
        throw err;
      });
  }

  CKB.PACE = PACE;
  CKB.deadline = deadline;
  CKB.challenged = challenged;
  CKB.after = after;
  CKB.fetchPage = fetchPage;
})(globalThis.CKB);
