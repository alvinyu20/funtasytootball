/*
  ============================================================
  ANIMATIONS
  ============================================================
  Shared, dependency-free motion utilities used across every page:
    - Charts draw themselves in once scrolled into view (SVG lines via
      a measured stroke-dasharray/dashoffset reveal, bar charts via a
      CSS custom property already wired up in charts.js/styles.css).
    - Headline numbers count up from 0 once scrolled into view.
    - Expandable dropdown rows (injury/FAAB detail lists) animate open
      and closed instead of snapping instantly.

  Every animated path here respects prefers-reduced-motion: reduce —
  charts and dropdowns fall back to a global CSS rule that disables all
  transitions, and the count-up (pure JS, not CSS-driven) checks for it
  directly and just renders the final value immediately.
*/

function prefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

/* ---------------------------------------------------------------------
   Chart draw-in
   --------------------------------------------------------------------- */

function animateLinesIn(wrap) {
  wrap.querySelectorAll(".lc-line").forEach((path) => {
    let length;
    try {
      length = path.getTotalLength();
    } catch (e) {
      return; // empty/degenerate path -- nothing to measure or animate
    }
    if (!length) return;
    // Set the starting state with transitions disabled, force a reflow
    // so the browser actually registers that as the "from" state, then
    // re-enable the transition and animate to 0 on the next frame. Skip
    // any of this and the browser can collapse "from" and "to" into a
    // single frame, so the line just appears already drawn.
    path.style.transition = "none";
    path.style.strokeDasharray = String(length);
    path.style.strokeDashoffset = String(length);
    path.getBoundingClientRect(); // force reflow
    path.style.transition = "";
    requestAnimationFrame(() => {
      path.style.strokeDashoffset = "0";
    });
  });
}

function revealLinesInstantly(wrap) {
  wrap.querySelectorAll(".lc-line").forEach((path) => {
    path.style.strokeDasharray = "";
    path.style.strokeDashoffset = "";
  });
}

/* ---------------------------------------------------------------------
   Count-up numbers
   --------------------------------------------------------------------- */

// Splits "text like this" into a leading non-numeric prefix (e.g. "$",
// "+"), the number itself (commas/decimal allowed), and a trailing
// suffix (e.g. "%", " pts"). Returns null for anything that isn't a
// single simple number, so callers can safely skip it rather than
// mangling something like a "10-4" record.
function parseNumberText(text) {
  const match = text.trim().match(/^([^\d-]*)(-?[\d,]+(?:\.\d+)?)(.*)$/);
  if (!match) return null;
  const [, prefix, numStr, suffix] = match;
  const value = parseFloat(numStr.replace(/,/g, ""));
  if (isNaN(value)) return null;
  const decimals = (numStr.split(".")[1] || "").length;
  return { prefix, suffix, value, decimals, hasCommas: numStr.includes(",") };
}

function formatCountValue(value, decimals, hasCommas) {
  const fixed = value.toFixed(decimals);
  if (!hasCommas) return fixed;
  const [intPart, decPart] = fixed.split(".");
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decPart ? `${withCommas}.${decPart}` : withCommas;
}

function animateCountUp(el) {
  const parsed = parseNumberText(el.textContent);
  if (!parsed) return; // not a simple single number -- leave it exactly as rendered
  const { prefix, suffix, value, decimals, hasCommas } = parsed;
  const duration = 900;
  const start = performance.now();
  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
    const shown = t < 1 ? value * eased : value; // land exactly on the true value, not a float-rounded approximation
    el.textContent = prefix + formatCountValue(shown, decimals, hasCommas) + suffix;
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/* ---------------------------------------------------------------------
   Scroll-triggered reveal — one shared observer drives both the chart
   draw-in and the count-up numbers, each element animating once and
   only once (unobserved immediately after).
   --------------------------------------------------------------------- */

function initScrollAnimations() {
  const barTargets = document.querySelectorAll(".bar-chart, .stacked-chart");
  const lineTargets = document.querySelectorAll(".line-chart-wrap");
  const countTargets = document.querySelectorAll("[data-count-up]");

  if (prefersReducedMotion() || !("IntersectionObserver" in window)) {
    // No motion wanted, or no observer support: just land everything in
    // its final, correct state immediately rather than animating.
    barTargets.forEach((el) => el.classList.add("in-view"));
    lineTargets.forEach((el) => revealLinesInstantly(el));
    return;
  }

  const observer = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        if (el.classList.contains("bar-chart") || el.classList.contains("stacked-chart")) {
          el.classList.add("in-view");
        } else if (el.classList.contains("line-chart-wrap")) {
          animateLinesIn(el);
        } else if (el.hasAttribute("data-count-up")) {
          animateCountUp(el);
        }
        obs.unobserve(el);
      });
    },
    { threshold: 0.2, rootMargin: "0px 0px -40px 0px" }
  );

  barTargets.forEach((el) => observer.observe(el));
  lineTargets.forEach((el) => observer.observe(el));
  countTargets.forEach((el) => observer.observe(el));
}

/* ---------------------------------------------------------------------
   Animated dropdowns — covers both expandable patterns used on the
   site: native <details class="rank-list-item"> (injury team rows,
   lineup sections) and the custom [data-faab-toggle] rows (FAAB/waiver
   rows, which can't use <details> since a player photo is a <div> and
   <summary> can only legally contain phrasing content). Both animate
   height via a measured max-height transition rather than snapping.
   --------------------------------------------------------------------- */

function animateOpen(content) {
  const target = content.scrollHeight;
  content.style.maxHeight = "0px";
  content.style.overflow = "hidden";
  // Force a reflow before animating to the measured height, same reason
  // as the chart line reveal above -- otherwise "0" and the target can
  // collapse into one frame and the content just pops open.
  content.getBoundingClientRect();
  content.style.transition = "max-height 0.28s ease";
  requestAnimationFrame(() => {
    content.style.maxHeight = target + "px";
  });
  content.addEventListener(
    "transitionend",
    function done() {
      content.style.maxHeight = "";
      content.style.overflow = "";
      content.style.transition = "";
    },
    { once: true }
  );
}

function animateClose(content, onDone) {
  const start = content.scrollHeight;
  content.style.maxHeight = start + "px";
  content.style.overflow = "hidden";
  content.getBoundingClientRect();
  content.style.transition = "max-height 0.22s ease";
  requestAnimationFrame(() => {
    content.style.maxHeight = "0px";
  });
  content.addEventListener(
    "transitionend",
    function done() {
      content.style.transition = "";
      if (onDone) onDone();
    },
    { once: true }
  );
}

function initAnimatedDropdowns() {
  const reduced = prefersReducedMotion();

  // Native <details> — intercept the click so the open/close can be
  // animated instead of snapping, while keeping <details>'s own
  // keyboard and screen-reader semantics intact.
  document.querySelectorAll("details.rank-list-item").forEach((details) => {
    const summary = details.querySelector("summary");
    const content = details.querySelector(".injury-detail-list, .bracket-lineup-section");
    if (!summary || !content) return;
    summary.addEventListener("click", (e) => {
      e.preventDefault();
      if (reduced) {
        details.open = !details.open;
        return;
      }
      if (details.open) {
        animateClose(content, () => {
          details.open = false;
        });
      } else {
        details.open = true;
        animateOpen(content);
      }
    });
  });

  // Custom JS-toggled rows (FAAB/waiver dropdowns).
  document.querySelectorAll("[data-faab-toggle]").forEach((row) => {
    row.onclick = () => {
      const content = row.nextElementSibling;
      if (!content) return;
      const isOpen = row.classList.contains("open");
      if (reduced) {
        content.style.display = isOpen ? "none" : "";
        row.classList.toggle("open", !isOpen);
        return;
      }
      if (isOpen) {
        row.classList.remove("open");
        animateClose(content, () => {
          content.style.display = "none";
        });
      } else {
        content.style.display = "";
        row.classList.add("open");
        animateOpen(content);
      }
    };
  });
}
