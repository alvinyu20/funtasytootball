const test = require("node:test");
const assert = require("node:assert");
const { parseCsv, parseCsvToObjects } = require("../scripts/update-injuries.js");

test("parseCsv: basic comma-separated rows", () => {
  const rows = parseCsv("a,b,c\n1,2,3\n4,5,6\n");
  assert.deepStrictEqual(rows, [["a", "b", "c"], ["1", "2", "3"], ["4", "5", "6"]]);
});

test("parseCsv: a quoted field containing a comma isn't split into extra columns", () => {
  const rows = parseCsv('name,team\n"Smith, John",NYJ\n');
  assert.deepStrictEqual(rows, [["name", "team"], ["Smith, John", "NYJ"]]);
});

test("parseCsv: a quoted field containing an embedded newline doesn't create an extra row", () => {
  const rows = parseCsv('name,note\n"Multi\nLine",ok\n');
  assert.deepStrictEqual(rows, [["name", "note"], ["Multi\nLine", "ok"]]);
});

test("parseCsv: an escaped double-quote (\"\") inside a quoted field becomes a single literal quote", () => {
  const rows = parseCsv('name\n"Say ""hi"" now"\n');
  assert.deepStrictEqual(rows, [["name"], ['Say "hi" now']]);
});

test("parseCsv: handles both CRLF and bare LF line endings", () => {
  const rows = parseCsv("a,b\r\n1,2\r\n3,4\n");
  assert.deepStrictEqual(rows, [["a", "b"], ["1", "2"], ["3", "4"]]);
});

test("parseCsv: a final row with no trailing newline is still included", () => {
  const rows = parseCsv("a,b\n1,2");
  assert.deepStrictEqual(rows, [["a", "b"], ["1", "2"]]);
});

test("parseCsvToObjects: maps each row to the header's field names", () => {
  const objs = parseCsvToObjects("gsis_id,full_name,position\nG1,Puka Nacua,WR\nG2,Joe Flacco,QB\n");
  assert.deepStrictEqual(objs, [
    { gsis_id: "G1", full_name: "Puka Nacua", position: "WR" },
    { gsis_id: "G2", full_name: "Joe Flacco", position: "QB" },
  ]);
});

test("parseCsvToObjects: silently drops any malformed row whose column count doesn't match the header, rather than misaligning fields", () => {
  const objs = parseCsvToObjects("a,b,c\n1,2,3\n1,2\n1,2,3,4\n5,6,7\n");
  assert.deepStrictEqual(objs, [
    { a: "1", b: "2", c: "3" },
    { a: "5", b: "6", c: "7" },
  ]);
});

test("parseCsvToObjects: an empty CSV produces an empty array, not an error", () => {
  assert.deepStrictEqual(parseCsvToObjects(""), []);
});
