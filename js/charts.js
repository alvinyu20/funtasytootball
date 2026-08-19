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
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, (d.value / maxVal) * 100)}%"></div></div>
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
          <div class="stacked-track" style="width:${Math.max(4, (totals[i] / maxTotal) * 100)}%">${segs}</div>
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
};
