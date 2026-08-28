const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules } = require("./helpers/site-env.js");

const ctx = loadSiteModules(["utils.js", "charts.js"]);
const { Charts } = ctx;

test("multiLineChart: crowded end labels stay at least 13px apart (collision avoidance)", () => {
  const series = [
    { name: "teamAlpha", color: "#E7B040", points: [{ x: "W1", y: 5 }, { x: "W2", y: 1 }] },
    { name: "teamBeta", color: "#7FED6E", points: [{ x: "W1", y: 5 }, { x: "W2", y: 2 }] },
    { name: "teamGamma", color: "#40DCE7", points: [{ x: "W1", y: 5 }, { x: "W2", y: 2.2 }] },
  ];
  const html = Charts.multiLineChart(series, { invertY: true });
  const tags = html.match(/<text class="lc-end-label[^>]*>/g);
  assert.strictEqual(tags.length, 3);
  const yPositions = tags.map((tag) => parseFloat(tag.match(/\by="([\d.]+)"/)[1]));
  for (let i = 1; i < yPositions.length; i++) {
    assert.ok(yPositions[i] - yPositions[i - 1] >= 12.9, `labels ${i - 1} and ${i} are only ${yPositions[i] - yPositions[i - 1]}px apart`);
  }
});

test("multiLineChart: leader detection picks the lowest final value when invertY is true (rank-style data)", () => {
  const series = [
    { name: "teamAlpha", color: "#E7B040", points: [{ x: "W1", y: 5 }, { x: "W2", y: 1 }] },
    { name: "teamBeta", color: "#7FED6E", points: [{ x: "W1", y: 5 }, { x: "W2", y: 2 }] },
  ];
  const html = Charts.multiLineChart(series, { invertY: true });
  assert.ok(/★[^<]*teamAlpha/.test(html), "teamAlpha (final value 1, the best rank) should be marked as the leader");
});

test("multiLineChart: leader detection picks the highest final value when invertY is false (e.g. playoff odds)", () => {
  const series = [
    { name: "longTeamNameHere", color: "#E7B040", points: [{ x: "W1", y: 50 }, { x: "W2", y: 95 }] },
    { name: "teamB", color: "#7FED6E", points: [{ x: "W1", y: 50 }, { x: "W2", y: 20 }] },
  ];
  const html = Charts.multiLineChart(series, { invertY: false });
  assert.ok(/★[^<]*longTeamNam/.test(html), "the highest final value (95%) should be marked as the leader");
});

test("multiLineChart: long series names truncate with an ellipsis", () => {
  const series = [
    { name: "longTeamNameHere", color: "#E7B040", points: [{ x: "W1", y: 50 }, { x: "W2", y: 95 }] },
    { name: "teamB", color: "#7FED6E", points: [{ x: "W1", y: 50 }, { x: "W2", y: 20 }] },
  ];
  const html = Charts.multiLineChart(series, { invertY: false });
  assert.ok(!html.includes(">★ longTeamNameHere<"), "the full untruncated name should not appear");
});

test("multiLineChart rankMode: rank 1 renders at the top (lowest y coordinate) and dots are larger", () => {
  const series = [
    { name: "teamAlpha", color: "#E7B040", points: [{ x: "Pre", y: 3 }, { x: "W1", y: 1 }] },
    { name: "teamBeta", color: "#7FED6E", points: [{ x: "Pre", y: 1 }, { x: "W1", y: 3 }] },
  ];
  const html = Charts.multiLineChart(series, { invertY: true, rankMode: true });
  assert.ok(html.includes('r="4"'), "rank mode should use larger dots than the default (r=2.5)");

  const alphaY = parseFloat(html.match(/data-series="teamAlpha"[^>]*cy="([\d.]+)"/g).slice(-1)[0].match(/cy="([\d.]+)"/)[1]);
  const betaY = parseFloat(html.match(/data-series="teamBeta"[^>]*cy="([\d.]+)"/g).slice(-1)[0].match(/cy="([\d.]+)"/)[1]);
  assert.ok(alphaY < betaY, "teamAlpha (rank 1 at the end) should have a lower y-coordinate — rank 1 renders at the top");
});

test("barChart: uses a CSS custom property for width (enables the scroll-triggered grow-in animation) rather than an inline width", () => {
  const html = Charts.barChart([{ label: "teamA", value: 1520.3 }, { label: "teamB", value: 1489.1 }]);
  assert.ok(html.includes("--bar-w:"), "should set the --bar-w custom property");
  assert.ok(!/style="width:\d/.test(html), "should not set a literal inline width — that would prevent the CSS-driven draw-in animation");
});

test("multiLineChart playoffCutoff: draws a shaded band and dashed line only in rankMode, spanning ranks 1 through the cutoff", () => {
  const series = [
    { name: "teamAlpha", color: "#E7B040", points: [{ x: "W1", y: 1 }, { x: "W2", y: 2 }] },
    { name: "teamBeta", color: "#7FED6E", points: [{ x: "W1", y: 4 }, { x: "W2", y: 6 }] },
  ];
  const html = Charts.multiLineChart(series, { invertY: true, rankMode: true, playoffCutoff: 4 });
  assert.ok(html.includes('class="lc-playoff-band"'), "should render the shaded playoff band");
  assert.ok(html.includes('class="lc-playoff-line"'), "should render the dashed cutoff line");
  assert.ok(html.includes("Playoff line"), "should label the cutoff line");
});

test("multiLineChart playoffCutoff: omitted (no band) when not in rankMode, even if a cutoff value is passed", () => {
  const series = [{ name: "teamAlpha", color: "#E7B040", points: [{ x: "W1", y: 50 }, { x: "W2", y: 80 }] }];
  const html = Charts.multiLineChart(series, { invertY: false, rankMode: false, playoffCutoff: 4 });
  assert.ok(!html.includes("lc-playoff-band"), "rankMode is required for the playoff band to make sense (ranks, not raw values)");
});

test("multiLineChart playoffCutoff: omitted when the cutoff is at or beyond the total number of ranks (nothing to shade)", () => {
  const series = [
    { name: "teamAlpha", color: "#E7B040", points: [{ x: "W1", y: 1 }, { x: "W2", y: 2 }] },
    { name: "teamBeta", color: "#7FED6E", points: [{ x: "W1", y: 2 }, { x: "W2", y: 1 }] },
  ];
  const html = Charts.multiLineChart(series, { invertY: true, rankMode: true, playoffCutoff: 2 });
  assert.ok(!html.includes("lc-playoff-band"), "a cutoff equal to the full field means everyone's in — nothing meaningful to shade");
});

test("multiLineChart annotations: renders a marker, connector, and label at the requested point", () => {
  const series = [{ name: "yulovesyou", color: "#E7B040", points: [{ x: "W1", y: 50 }, { x: "W2", y: 100 }, { x: "W3", y: 100 }] }];
  const html = Charts.multiLineChart(series, {
    annotations: [{ seriesName: "yulovesyou", pointIndex: 1, label: "Clinched — Wk 2", color: "var(--gold)", direction: "down" }],
  });
  assert.ok(html.includes("lc-annotation-dot"), "should render the annotation marker");
  assert.ok(html.includes("lc-annotation-connector"), "should render the connector line");
  assert.ok(html.includes("Clinched — Wk 2"), "should render the label text");
});

test("multiLineChart annotations: silently skips an annotation whose series or point doesn't exist, rather than throwing", () => {
  const series = [{ name: "yulovesyou", color: "#E7B040", points: [{ x: "W1", y: 50 }] }];
  assert.doesNotThrow(() => {
    Charts.multiLineChart(series, {
      annotations: [
        { seriesName: "doesNotExist", pointIndex: 0, label: "Ghost annotation" },
        { seriesName: "yulovesyou", pointIndex: 99, label: "Out of range" },
      ],
    });
  });
  const html = Charts.multiLineChart(series, {
    annotations: [{ seriesName: "doesNotExist", pointIndex: 0, label: "Ghost annotation" }],
  });
  assert.ok(!html.includes("Ghost annotation"), "an annotation for a nonexistent series should not render");
});

test("multiLineChart annotations: skips an annotation pointing at a gap (null y-value) in the series", () => {
  const series = [{ name: "yulovesyou", color: "#E7B040", points: [{ x: "W1", y: 50 }, { x: "W2", y: null }] }];
  const html = Charts.multiLineChart(series, {
    annotations: [{ seriesName: "yulovesyou", pointIndex: 1, label: "Should not appear" }],
  });
  assert.ok(!html.includes("Should not appear"));
});
