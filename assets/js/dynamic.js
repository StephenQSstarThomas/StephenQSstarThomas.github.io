/* ==========================================================================
   Minimal site JS — bilingual toggle + post view counter. Nothing else.
   ========================================================================== */
(function () {
  "use strict";

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(function () {
    /* ---------- Bilingual containers: language toggle (persisted, shared) ---------- */
    (function () {
      var containers = document.querySelectorAll(".bilingual");
      if (!containers.length) return;
      function apply(lang) {
        Array.prototype.forEach.call(containers, function (c) {
          c.setAttribute("data-lang", lang);
        });
        Array.prototype.forEach.call(document.querySelectorAll(".lang-btn"), function (b) {
          b.classList.toggle("is-active", b.getAttribute("data-set-lang") === lang);
        });
      }
      var saved = null;
      try { saved = localStorage.getItem("blog-lang"); } catch (e) {}
      apply(saved || containers[0].getAttribute("data-lang") || "en");
      Array.prototype.forEach.call(document.querySelectorAll(".lang-btn"), function (b) {
        b.addEventListener("click", function () {
          var lang = b.getAttribute("data-set-lang");
          apply(lang);
          try { localStorage.setItem("blog-lang", lang); } catch (e) {}
        });
      });
    })();

    /* ---------- Post view counter (Abacus, no signup) ----------
       The .post-views span is hidden by CSS and only revealed on a
       successful fetch, so blocked/offline/no-JS readers never see a
       stray placeholder or a wrong count. */
    (function () {
      var stats = document.querySelector(".post-views");
      if (!stats || !window.fetch) return;
      var ns = stats.getAttribute("data-ns");
      var key = (stats.getAttribute("data-key") || "post").replace(/[^a-z0-9_-]/gi, "-");
      var viewsEl = stats.querySelector('[data-role="views"]');
      if (!ns || !viewsEl) return;
      var base = "https://abacus.jasoncameron.dev";
      // Count once per browser session (a refresh doesn't inflate the count)
      var counted = false;
      try { counted = sessionStorage.getItem("viewed-" + key) === "1"; } catch (e) {}
      fetch(base + (counted ? "/get/" : "/hit/") + ns + "/" + key)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d || typeof d.value !== "number") return;
          viewsEl.textContent = d.value.toLocaleString();
          stats.style.display = "inline";
          if (!counted) { try { sessionStorage.setItem("viewed-" + key, "1"); } catch (e) {} }
        })
        .catch(function () {});
    })();
  });
})();
