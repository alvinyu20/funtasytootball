/*
  ============================================================
  CHARTS
  ============================================================
  Small, dependency-free chart renderers used on the Season page.
  Each function returns an HTML string ready to drop into innerHTML.
  Colors are pulled from the site's CSS custom properties so charts
  stay in sync with the rest of the design automatically.
*/

const Charts = {
  // data: [{ label, value }]
  barChart(data, { formatter = (v) => v.toFixed(1) } = {}) {
    if (!data.length) return `<div class="empty-state">Not enough data yet.</div>`;
    const maxVal = Math.max(1, ...data.map((d) => d.value));
    return `<div class="bar-chart">${data
      .map(
        (d) => `
      <div class="bar-chart-row">
        <span class="bar-label">${escapeHtml(d.label)}</span>
        <div class="bar-track"><div class="bar-fill" style="--bar-w:${Math.max(2, (d.value / maxVal) * 100)}%"></div></div>
        <span class="bar-value">${formatter(d.value)}</span>
      </div>`
      )
      .join("")}</div>`;
  },

  // rows: [{ label, segments: { key: value, ... } }]
  // segmentDefs: [{ key, label, color }] in the order they should stack/appear in the legend
  stackedBarChart(rows, segmentDefs, { formatter = (v) => v.toFixed(0) } = {}) {
    if (!rows.length) return `<div class="empty-state">Not enough data yet.</div>`;
    const totals = rows.map((r) => segmentDefs.reduce((sum, s) => sum + (r.segments[s.key] || 0), 0));
    const maxTotal = Math.max(1, ...totals);

    const bars = rows
      .map((r, i) => {
        const segs = segmentDefs
          .map((s) => {
            const val = r.segments[s.key] || 0;
            if (val <= 0) return "";
            const pct = (val / maxTotal) * 100;
            return `<div class="stacked-seg" style="width:${pct}%; background:${s.color};" title="${escapeHtml(s.label)}: ${formatter(val)}"></div>`;
          })
          .join("");
        return `
        <div class="stacked-row">
          <span class="bar-label">${escapeHtml(r.label)}</span>
          <div class="stacked-track" style="--bar-w:${Math.max(4, (totals[i] / maxTotal) * 100)}%">${segs}</div>
        </div>`;
      })
      .join("");

    const legend = segmentDefs
      .map((s) => `<span><span class="swatch" style="background:${s.color}"></span>${escapeHtml(s.label)}</span>`)
      .join("");

    return `<div class="stacked-chart">${bars}</div><div class="chart-legend">${legend}</div>`;
  },

  // points: [{ x: labelForThisPoint, y: numericValue }], in x order
  lineChart(points, { width = 640, height = 220, formatter = (v) => v.toFixed(1) } = {}) {
    if (!points.length) return `<div class="empty-state">Not enough data yet.</div>`;

    const padL = 44, padR = 16, padT = 16, padB = 28;
    const innerW = width - padL - padR;
    const innerH = height - padT - padB;

    const values = points.map((p) => p.y);
    const minY = Math.min(...values);
    const maxY = Math.max(...values);
    const yRange = maxY - minY || 1;

    const xStep = points.length > 1 ? innerW / (points.length - 1) : 0;
    const coords = points.map((p, i) => ({
      x: padL + i * xStep,
      y: padT + innerH - ((p.y - minY) / yRange) * innerH,
      label: p.x,
    }));

    const path = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");

    const gridLines = [0, 0.5, 1]
      .map((f) => {
        const y = padT + innerH * f;
        return `<line class="lc-grid" x1="${padL}" y1="${y.toFixed(1)}" x2="${width - padR}" y2="${y.toFixed(1)}" />`;
      })
      .join("");

    const dots = coords.map((c) => `<circle class="lc-dot" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3"><title>${escapeHtml(String(c.label))}</title></circle>`).join("");

    // Thin out x-axis labels if there are many points, so they don't overlap.
    const labelEvery = Math.max(1, Math.ceil(points.length / 12));
    const xLabels = coords
      .filter((_, i) => i % labelEvery === 0)
      .map((c) => `<text class="lc-axis-label" x="${c.x.toFixed(1)}" y="${height - 8}" text-anchor="middle">${escapeHtml(String(c.label))}</text>`)
      .join("");

    const yLabels = [minY, (minY + maxY) / 2, maxY]
      .map((v) => {
        const y = padT + innerH - ((v - minY) / yRange) * innerH;
        return `<text class="lc-value-label" x="${padL - 8}" y="${(y + 3).toFixed(1)}" text-anchor="end">${formatter(v)}</text>`;
      })
      .join("");

    return `
      <div class="line-chart-wrap">
        <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="xMinYMin meet">
          ${gridLines}
          ${yLabels}
          <path class="lc-line" d="${path}"></path>
          ${dots}
          ${xLabels}
        </svg>
      </div>`;
  },

  // Multiple teams' trajectories on one chart. series: [{ name, color,
  // points: [{x, y}] }] — every series should share the same x values
  // (e.g. "Pre", "W1", "W2", ...). Set invertY: true for rank-style data
  // where smaller is better (so rank 1 plots at the top). Set rankMode:
  // true for a true bump-chart look — Y positions become evenly-spaced
  // integer rank slots (a gridline + label at every rank, 1 at top)
  // instead of a continuous min/max value scale, and dots render larger
  // as bump-chart "nodes". Every line, dot, and end label carries a
  // data-series attribute so hover highlighting (see
  // initChartHoverLinking in animations.js) can tie them together.
  //
  // playoffCutoff (rankMode only): shades ranks 1..N as a "still in the
  // playoff picture" band with a dashed boundary line, the same cutoff
  // the Standings Over Time replay already marks.
  //
  // annotations: [{ seriesName, pointIndex, label, color, direction }]
  // — marks one specific point directly on the chart with a short
  // connector and a label, instead of leaving the reader to spot it
  // (e.g. "Clinched — Wk 12"). direction is "up" or "down" (default
  // "up") for which way the label extends from the point; the caller
  // picks whichever avoids colliding with the line's own shape. Each
  // annotation is tagged with its own series and, like the lines/dots/
  // end-labels above, is hidden until that series is hovered (CSS in
  // styles.css) — so a chart with one annotation per series (10 teams,
  // 10 different clinch/elimination weeks) only ever shows the one the
  // reader is currently pointing at, not all of them stacked at once.
  multiLineChart(series, { width = 720, height = 360, formatter = (v) => v.toFixed(1), invertY = false, rankMode = false, playoffCutoff = null, annotations = [] } = {}) {
    const validSeries = series.filter((s) => s.points && s.points.length);
    if (!validSeries.length) return `<div class="empty-state">Not enough data yet.</div>`;

    // Wider right margin than the single-series line chart — this is
    // where the direct end-of-line labels live, replacing a separate
    // legend below the chart (NYT's graphics team calls this out
    // specifically: a tooltip or legend the reader has to cross-reference
    // gets skipped; a label sitting right at the line doesn't).
    const padL = rankMode ? 28 : 40, padR = 92, padT = 16, padB = 32;
    const innerW = width - padL - padR;
    const innerH = height - padT - padB;

    const allY = validSeries.flatMap((s) => s.points.map((p) => p.y)).filter((v) => v != null);
    const minY = Math.min(...allY);
    const maxY = Math.max(...allY);
    const yRange = maxY - minY || 1;
    const rankCount = rankMode ? Math.max(1, Math.round(maxY)) : null;

    function yFor(value) {
      if (rankMode) {
        const t = (value - 1) / Math.max(1, rankCount - 1);
        return padT + t * innerH;
      }
      const t = (value - minY) / yRange;
      return invertY ? padT + t * innerH : padT + innerH - t * innerH;
    }

    const pointCount = validSeries[0].points.length;
    const xStep = pointCount > 1 ? innerW / (pointCount - 1) : 0;
    function xFor(i) {
      return padL + i * xStep;
    }

    // Playoff cutoff band — drawn first (and so behind everything else in
    // SVG's paint order) so gridlines, lines, and dots all sit on top of
    // the shaded region rather than under it.
    const playoffBandHtml =
      rankMode && playoffCutoff && playoffCutoff < rankCount
        ? (() => {
            const bandBottom = yFor(playoffCutoff + 0.5);
            return `
      <rect class="lc-playoff-band" x="${padL}" y="${padT}" width="${innerW}" height="${(bandBottom - padT).toFixed(1)}"></rect>
      <line class="lc-playoff-line" x1="${padL}" y1="${bandBottom.toFixed(1)}" x2="${width - padR}" y2="${bandBottom.toFixed(1)}"></line>
      <text class="lc-playoff-label" x="${(width - padR).toFixed(1)}" y="${(bandBottom - 5).toFixed(1)}" text-anchor="end">Playoff line</text>`;
          })()
        : "";

    // Rank mode gets a gridline + rank-number label at every integer
    // rank (the classic bump-chart look); everything else keeps the
    // existing 3 fractional gridlines with min/mid/max value labels.
    const gridLines = rankMode
      ? Array.from({ length: rankCount }, (_, i) => i + 1)
          .map((rank) => {
            const y = yFor(rank);
            return `<line class="lc-grid" x1="${padL}" y1="${y.toFixed(1)}" x2="${width - padR}" y2="${y.toFixed(1)}" />`;
          })
          .join("")
      : [0, 0.5, 1]
          .map((f) => {
            const y = padT + innerH * f;
            return `<line class="lc-grid" x1="${padL}" y1="${y.toFixed(1)}" x2="${width - padR}" y2="${y.toFixed(1)}" />`;
          })
          .join("");

    // Any point with a missing y-value (e.g. a season with no "Pre" data)
    // breaks the line into a gap rather than being drawn at a wrong
    // position, so one missing data point can't corrupt the whole chart.
    // Also tracks each series' last plotted point, needed below for the
    // direct end labels and leader highlight.
    const dotRadius = rankMode ? 4 : 2.5;
    const lastPointBySeries = new Map(); // series index -> { x, y, value }
    const paths = validSeries
      .map((s, si) => {
        const seriesAttr = escapeHtml(s.name);
        let d = "";
        let started = false;
        s.points.forEach((p, i) => {
          if (p.y == null) {
            started = false;
            return;
          }
          const x = xFor(i).toFixed(1);
          const y = yFor(p.y).toFixed(1);
          d += `${started ? " L" : d ? " M" : "M"}${x},${y}`;
          started = true;
          lastPointBySeries.set(si, { x: xFor(i), y: yFor(p.y), value: p.y });
        });
        const dots = s.points
          .map((p, i) =>
            p.y == null
              ? ""
              : `<circle class="lc-dot" data-series="${seriesAttr}" cx="${xFor(i).toFixed(1)}" cy="${yFor(p.y).toFixed(1)}" r="${dotRadius}" style="fill:${
                  s.color
                }"><title>${escapeHtml(s.name)} · ${escapeHtml(String(p.x))}: ${formatter(p.y)}</title></circle>`
          )
          .join("");
        return { si, s, d, dots, seriesAttr };
      });

    // The leader is whoever's most recent value is "best" — lowest for
    // rank-style (invertY) data, highest otherwise. Drawn with a bolder
    // stroke and a marked label, so the chart's single most important
    // fact is visible without anyone having to hover for it.
    let leaderSi = null;
    lastPointBySeries.forEach((pt, si) => {
      if (leaderSi === null) {
        leaderSi = si;
        return;
      }
      const cur = lastPointBySeries.get(leaderSi);
      const better = invertY ? pt.value < cur.value : pt.value > cur.value;
      if (better) leaderSi = si;
    });

    const pathsHtml = paths
      .map(
        ({ si, s, d, dots, seriesAttr }) => `
      <path class="lc-line-hover-catcher" data-series="${seriesAttr}" d="${d}"></path>
      <path class="lc-line${si === leaderSi ? " lc-line-leader" : ""}" data-series="${seriesAttr}" style="stroke:${s.color}" d="${d}"></path>${dots}`
      )
      .join("");

    const labelEvery = Math.max(1, Math.ceil(pointCount / 14));
    const xLabels = validSeries[0].points
      .filter((_, i) => i % labelEvery === 0)
      .map((p, idx) => {
        const i = idx * labelEvery;
        return `<text class="lc-axis-label" x="${xFor(i).toFixed(1)}" y="${height - 8}" text-anchor="middle">${escapeHtml(String(p.x))}</text>`;
      })
      .join("");

    const yLabels = rankMode
      ? Array.from({ length: rankCount }, (_, i) => i + 1)
          .map((rank) => `<text class="lc-value-label" x="${padL - 8}" y="${(yFor(rank) + 3).toFixed(1)}" text-anchor="end">${rank}</text>`)
          .join("")
      : [minY, (minY + maxY) / 2, maxY]
          .map((v) => `<text class="lc-value-label" x="${padL - 8}" y="${(yFor(v) + 3).toFixed(1)}" text-anchor="end">${formatter(v)}</text>`)
          .join("");

    // Direct end-of-line labels, replacing the separate legend below the
    // chart. Sorted top to bottom and pushed apart wherever two lines
    // would otherwise end close enough to overlap — a standard
    // label-collision technique, kept simple since this chart tops out
    // around 10 series.
    const MAX_LABEL_CHARS = 12;
    function truncateLabel(name) {
      return name.length > MAX_LABEL_CHARS ? name.slice(0, MAX_LABEL_CHARS - 1) + "…" : name;
    }
    const labelMinGap = 13;
    const endLabelData = validSeries
      .map((s, si) => {
        const pt = lastPointBySeries.get(si);
        if (!pt) return null;
        return { si, name: s.name, color: s.color, rawY: pt.y, x: pt.x };
      })
      .filter(Boolean)
      .sort((a, b) => a.rawY - b.rawY);
    let prevY = -Infinity;
    endLabelData.forEach((lbl) => {
      lbl.adjY = Math.max(lbl.rawY, prevY + labelMinGap);
      prevY = lbl.adjY;
    });
    const endLabels = endLabelData
      .map(
        (lbl) => `
      <text class="lc-end-label${lbl.si === leaderSi ? " lc-end-label-leader" : ""}" data-series="${escapeHtml(lbl.name)}" x="${(lbl.x + 8).toFixed(
          1
        )}" y="${(lbl.adjY + 3).toFixed(1)}" style="fill:${lbl.color}">${lbl.si === leaderSi ? "★ " : ""}${escapeHtml(truncateLabel(lbl.name))}</text>`
      )
      .join("");

    // Marks one specific point directly on the chart with a short dashed
    // connector and a label — e.g. "Clinched — Wk 12" — rather than
    // leaving the reader to find the moment themselves. Tagged with the
    // same data-series attribute as its line/dot/end-label, so when a
    // chart carries one annotation per series (e.g. every team's own
    // playoff clinch/elimination week), only the currently-hovered
    // team's annotation is visible at a time — see the lc-annotation-*
    // opacity rules in styles.css — instead of up to 2 annotations per
    // series all competing for space at once. Silently skips an
    // annotation whose series/point doesn't exist or has no value
    // there, so a caller can pass a "maybe" annotation without checking
    // first.
    const annotationsHtml = (annotations || [])
      .map((ann) => {
        const s = validSeries.find((vs) => vs.name === ann.seriesName);
        const pt = s && s.points[ann.pointIndex];
        if (!pt || pt.y == null) return "";
        const x = xFor(ann.pointIndex);
        const y = yFor(pt.y);
        const dir = ann.direction === "down" ? 1 : -1;
        const labelY = y + dir * 34;
        const color = ann.color || "#E8B23D";
        const seriesAttr = escapeHtml(ann.seriesName);
        return `
      <line class="lc-annotation-connector" data-series="${seriesAttr}" x1="${x.toFixed(1)}" y1="${(y + dir * 6).toFixed(1)}" x2="${x.toFixed(
          1
        )}" y2="${(labelY - dir * 12).toFixed(1)}" style="stroke:${color}"></line>
      <circle class="lc-annotation-dot" data-series="${seriesAttr}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" style="fill:${color}"></circle>
      <text class="lc-annotation-label" data-series="${seriesAttr}" x="${x.toFixed(1)}" y="${(labelY + (dir === -1 ? -4 : 12)).toFixed(
          1
        )}" text-anchor="middle" style="fill:${color}">${escapeHtml(ann.label)}</text>`;
      })
      .join("");

    return `
      <div class="line-chart-wrap">
        <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="xMinYMin meet">
          ${playoffBandHtml}
          ${gridLines}
          ${yLabels}
          ${pathsHtml}
          ${xLabels}
          ${endLabels}
          ${annotationsHtml}
        </svg>
      </div>`;
  },
};

// A qualitative color palette for up to 10 distinct trajectory lines.
// Hues are evenly spaced around the color wheel and interleaved (not
// assigned in hue order) so that any two ADJACENT positions in this list
// are at least 72° apart in hue, not just any two colors in the set —
// since teams are assigned colors by list position, adjacent teams in a
// legend are the ones most likely to need telling apart at a glance.
// Lightness alternates between entries for extra separation on top of hue.
const MULTI_LINE_COLORS = [
  "#E7B040", "#7FED6E", "#40DCE7", "#906EED", "#E74099",
  "#CBED6E", "#40E78E", "#6E98ED", "#D140E7", "#ED766E",
];
