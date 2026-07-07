/* ==========================================================================
   Dynamic factors — scroll reveal, count-up stats, scroll progress, back-to-top.
   Vanilla JS, no dependencies. Loaded after main.min.js.

   DEGRADES GRACEFULLY: the pre-animation "hidden" CSS states are scoped under
   html.js-reveal, and that class is added synchronously below. So if this
   script is blocked, 404s, or errors, NOTHING is ever hidden.
   ========================================================================== */
(function () {
  "use strict";

  // Added synchronously: only now do the opacity:0 reveal states apply.
  document.documentElement.classList.add("js-reveal");

  var REDUCED =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(function () {
    /* ---------- Auto-tag homepage content blocks as reveal targets ---------- */
    // Avoids fragile kramdown class attachment: section headings and cards
    // fade up on scroll; body paragraphs stay calm.
    var content = document.querySelector(".page__content");
    if (content) {
      var autoSel = "h1, .paper-box, .project-card, .stat-strip";
      Array.prototype.forEach.call(content.querySelectorAll(autoSel), function (el) {
        // don't double-tag things already inside a reveal wrapper
        el.classList.add("reveal");
      });
    }

    /* ---------- Stagger containers: set per-child index for cascade ---------- */
    Array.prototype.forEach.call(document.querySelectorAll(".stagger"), function (list) {
      Array.prototype.forEach.call(list.children, function (c, i) {
        c.style.setProperty("--i", Math.min(i, 10));
      });
      list.classList.add("reveal"); // reuse the reveal observer to trigger the cascade
    });

    /* ---------- Bilingual containers: language toggle (persisted, shared) ---------- */
    (function () {
      var containers = document.querySelectorAll(".bilingual");
      if (!containers.length) return;
      function apply(lang) {
        Array.prototype.forEach.call(containers, function (c) {
          c.setAttribute("data-lang", lang);
          Array.prototype.forEach.call(c.querySelectorAll(".lang-btn"), function (b) {
            b.classList.toggle("is-active", b.getAttribute("data-set-lang") === lang);
          });
        });
        // the visible section headings changed — re-map the squirrel rail's acorns
        if (window.__refreshRail) setTimeout(window.__refreshRail, 40);
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

    /* ---------- 1. Scroll reveal (IntersectionObserver) ---------- */
    var revealEls = Array.prototype.slice.call(
      document.querySelectorAll(".reveal")
    );

    if (REDUCED || !("IntersectionObserver" in window)) {
      revealEls.forEach(function (el) {
        el.classList.add("is-visible");
      });
    } else {
      var io = new IntersectionObserver(
        function (entries, obs) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-visible");
              obs.unobserve(entry.target);
            }
          });
        },
        { rootMargin: "0px 0px -8% 0px", threshold: 0.06 }
      );
      revealEls.forEach(function (el, i) {
        var delay = Math.min((i % 5) * 55, 220);
        el.style.transitionDelay = delay + "ms";
        io.observe(el);
      });
      // Failsafe: never leave anything hidden more than 2.5s.
      setTimeout(function () {
        revealEls.forEach(function (el) {
          el.classList.add("is-visible");
        });
      }, 2500);
    }

    /* ---------- 2. Count-up number counters ---------- */
    // <span class="countup" data-target="22000" data-suffix="+">22,000+</span>
    function animateCount(el) {
      var target = parseFloat(el.getAttribute("data-target"));
      if (isNaN(target)) return;
      var suffix = el.getAttribute("data-suffix") || "";
      var prefix = el.getAttribute("data-prefix") || "";
      if (REDUCED || !window.requestAnimationFrame) {
        el.textContent = prefix + target.toLocaleString() + suffix;
        return;
      }
      var dur = 1500,
        t0 = null;
      function step(ts) {
        if (t0 === null) t0 = ts;
        var p = Math.min((ts - t0) / dur, 1);
        var eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
        el.textContent = prefix + Math.round(target * eased).toLocaleString() + suffix;
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }

    // Exposed so the async Google-Scholar fetch can animate live values
    // (citations / publications) once the JSON resolves.
    window.animateCountEl = animateCount;

    var counters = Array.prototype.slice.call(
      document.querySelectorAll(".countup")
    );
    if (counters.length) {
      if (!("IntersectionObserver" in window)) {
        counters.forEach(animateCount);
      } else {
        var cio = new IntersectionObserver(
          function (entries, obs) {
            entries.forEach(function (entry) {
              if (entry.isIntersecting) {
                animateCount(entry.target);
                obs.unobserve(entry.target);
              }
            });
          },
          { threshold: 0.6 }
        );
        counters.forEach(function (el) {
          cio.observe(el);
        });
      }
    }

    /* ---------- Signature: header aurora (skip if reduced motion) ---------- */
    if (!REDUCED) {
      var aurora = document.createElement("div");
      aurora.id = "aurora";
      aurora.setAttribute("aria-hidden", "true");
      document.body.insertBefore(aurora, document.body.firstChild);
    }

    /* ---------- Signature: pointer-tracked spotlight on cards ---------- */
    if (!REDUCED && window.matchMedia && window.matchMedia("(hover: hover)").matches) {
      var cards = document.querySelectorAll(".paper-box, .project-card, .post-card");
      Array.prototype.forEach.call(cards, function (card) {
        card.addEventListener("pointermove", function (e) {
          var r = card.getBoundingClientRect();
          card.style.setProperty("--mx", (e.clientX - r.left) + "px");
          card.style.setProperty("--my", (e.clientY - r.top) + "px");
        });
      });
    }

    /* ---------- 3. Reading progress: a squirrel rail on posts, else a slim bar ---------- */
    var postBody = document.querySelector(".post-body");
    var bar = null, rail = null, railFill = null, railSquirrel = null, acorns = [];

    if (postBody) {
      rail = document.createElement("div");
      rail.id = "reading-rail";
      rail.setAttribute("aria-hidden", "true");
      rail.innerHTML =
        '<div class="rail-track"></div><div class="rail-fill"></div><span class="rail-squirrel">🐿️</span>';
      document.body.appendChild(rail);
      document.body.classList.add("has-rail");
      railFill = rail.querySelector(".rail-fill");
      railSquirrel = rail.querySelector(".rail-squirrel");

      // Only the visible language's headings count (the other is display:none).
      var visibleHeads = function () {
        return Array.prototype.filter.call(
          postBody.querySelectorAll("h3"),
          function (h) { return h.offsetParent !== null; }
        );
      };
      // Build one acorn per section; re-map them to the visible language on refresh.
      var n = visibleHeads().length;
      for (var k = 0; k < n; k++) {
        var a = document.createElement("button");
        a.className = "rail-acorn";
        a.type = "button";
        a.textContent = "🌰";
        (function (idx) {
          a.addEventListener("click", function () {
            var o = acorns[idx];
            if (o.head) o.head.scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" });
          });
        })(k);
        rail.appendChild(a);
        acorns.push({ el: a, head: null, pct: 0 });
      }

      var placeAcorns = function () {
        var vis = visibleHeads();
        var max = document.documentElement.scrollHeight - window.innerHeight;
        for (var i = 0; i < acorns.length; i++) {
          var h = vis[i];
          if (!h) { acorns[i].el.style.display = "none"; continue; }
          acorns[i].el.style.display = "";
          acorns[i].head = h;
          acorns[i].el.setAttribute("aria-label", h.textContent.replace(/\s+/g, " ").trim());
          var top = h.getBoundingClientRect().top + window.pageYOffset;
          acorns[i].pct = max > 0 ? Math.min(top / max, 1) * 100 : 0;
          acorns[i].el.style.left = acorns[i].pct + "%";
        }
      };
      placeAcorns();
      window.addEventListener("resize", placeAcorns, { passive: true });
      setTimeout(placeAcorns, 900); // after fonts/images settle
      window.__refreshRail = placeAcorns; // language toggle calls this
    } else {
      bar = document.createElement("div");
      bar.id = "scroll-progress";
      bar.setAttribute("aria-hidden", "true");
      document.body.appendChild(bar);
    }

    /* ---------- 4. Back-to-top button ---------- */
    var toTop = document.createElement("button");
    toTop.id = "back-top";
    toTop.setAttribute("aria-label", "Back to top");
    toTop.innerHTML = "↑";
    document.body.appendChild(toTop);
    toTop.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: REDUCED ? "auto" : "smooth" });
    });

    var ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        var d = document.documentElement;
        var scrollTop = d.scrollTop || document.body.scrollTop;
        var max = d.scrollHeight - d.clientHeight;
        var ratio = max > 0 ? scrollTop / max : 0;
        var pctv = ratio * 100;
        if (bar) bar.style.transform = "scaleX(" + ratio + ")";
        if (rail) {
          railFill.style.width = pctv + "%";
          railSquirrel.style.left = pctv + "%";
          for (var i = 0; i < acorns.length; i++) {
            acorns[i].el.classList.toggle("reached", pctv >= acorns[i].pct - 0.3);
          }
        }
        if (scrollTop > 600) toTop.classList.add("show");
        else toTop.classList.remove("show");
        ticking = false;
      });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  });
})();
