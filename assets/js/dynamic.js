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

    /* ---------- 3. Scroll progress bar ---------- */
    var bar = document.createElement("div");
    bar.id = "scroll-progress";
    bar.setAttribute("aria-hidden", "true");
    document.body.appendChild(bar);

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
        var doc = document.documentElement;
        var scrollTop = doc.scrollTop || document.body.scrollTop;
        var max = doc.scrollHeight - doc.clientHeight;
        var ratio = max > 0 ? scrollTop / max : 0;
        bar.style.transform = "scaleX(" + ratio + ")";
        if (scrollTop > 600) toTop.classList.add("show");
        else toTop.classList.remove("show");
        ticking = false;
      });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  });
})();
