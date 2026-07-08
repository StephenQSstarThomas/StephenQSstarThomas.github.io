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

    /* ---------- Homepage: highlight the section rail on scroll ---------- */
    (function () {
      var nav = document.querySelector(".side-nav");
      if (!nav) return;
      var links = Array.prototype.slice.call(nav.querySelectorAll("a"));
      var secs = links.map(function (a) {
        var h = a.getAttribute("href");
        return h && h.charAt(0) === "#" ? document.getElementById(h.slice(1)) : null;
      });
      function onScroll() {
        var y = window.scrollY + window.innerHeight * 0.28;
        var idx = 0;
        for (var i = 0; i < secs.length; i++) {
          if (secs[i] && secs[i].offsetTop <= y) idx = i;
        }
        links.forEach(function (a, i) { a.classList.toggle("is-active", i === idx); });
      }
      var t = null;
      window.addEventListener("scroll", function () {
        if (t) return;
        t = setTimeout(function () { t = null; onScroll(); }, 80);
      }, { passive: true });
      onScroll();
    })();

    /* ---------- Long posts: auto table of contents (bilingual-aware) ---------- */
    (function () {
      var body = document.querySelector(".post-body");
      var header = document.querySelector(".post-header");
      if (!body || !header) return;
      var article = document.querySelector(".post.bilingual");

      function scope() {
        if (!article) return body;
        var lang = article.getAttribute("data-lang") || "en";
        return body.querySelector(".lang-" + lang) || body;
      }

      var toc = document.createElement("nav");
      toc.className = "post-toc";
      toc.setAttribute("aria-label", "Table of contents");

      function build() {
        var sc = scope();
        var hs = Array.prototype.slice.call(sc.querySelectorAll("h2, h3"));
        if (hs.length < 3) { toc.style.display = "none"; return; }
        toc.style.display = "";
        var lang = article ? (article.getAttribute("data-lang") || "en") : "en";
        var label = lang === "zh" ? "目录" : "Contents";
        var out = '<p class="post-toc-h">' + label + "</p><ol>";
        hs.forEach(function (h, i) {
          if (!h.id) h.id = "sec-" + lang + "-" + i;
          var m = h.textContent.match(/^\s*(\d+)\./);
          var num = m ? m[1] : "";
          var text = h.textContent.replace(/^\s*\d+\.\s*/, "");
          out += "<li>" + (num ? '<span class="post-toc-num">' + num + "</span>" : "") +
                 '<a href="#' + h.id + '">' + text + "</a></li>";
        });
        out += "</ol>";
        toc.innerHTML = out;
      }

      build();
      header.parentNode.insertBefore(toc, header.nextSibling);
      Array.prototype.forEach.call(document.querySelectorAll(".lang-btn"), function (b) {
        b.addEventListener("click", function () { setTimeout(build, 0); });
      });
    })();
  });
})();
