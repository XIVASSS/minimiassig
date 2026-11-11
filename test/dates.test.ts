import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDates } from "../src/memory/dates.js";
import { zonedTime } from "../src/memory/time.js";

const TZ = "Asia/Kolkata";
const NOW = new Date("2026-11-10T06:30:00.000Z");

function labels(text: string): string[] {
  return parseDates(text, NOW, TZ).ranges.map((range) => range.label);
}

describe("parseDates", () => {
  it("treats last Tuesday on a Tuesday as seven days earlier", () => {
    const parsed = parseDates("Last Tuesday I asked you about Postgres hosting.", NOW, TZ);
    assert.deepEqual(labels("Last Tuesday I asked you about Postgres hosting."), ["Tue 3 Nov 2026"]);
    assert.match(parsed.assumptions[0], /last Tuesday/i);
    assert.match(parsed.assumptions[0], /3 Nov 2026/);
  });

  it("treats Monday as the most recent Monday", () => {
    assert.deepEqual(
      labels("On Monday we shortlisted 5 CRM tools."),
      ["Mon 9 Nov 2026"],
    );
  });

  it("resolves 3 November in the current year", () => {
    assert.deepEqual(labels("What did I ask you on 3 November?"), ["Tue 3 Nov 2026"]);
  });

  it("does not treat today as a day to look up", () => {
    assert.deepEqual(
      labels("What did I ask you on 3 November? Is your answer still correct today?"),
      ["Tue 3 Nov 2026"],
    );
  });

  it("keeps an explicit earlier year", () => {
    assert.deepEqual(labels("What happened on 3 November 2025?"), ["Mon 3 Nov 2025"]);
  });

  it("bounds a day in the user timezone", () => {
    const start = zonedTime(2026, 11, 9, 0, 0, 0, TZ);
    assert.equal(start.toISOString(), "2026-11-08T18:30:00.000Z");
  });
});
