import * as chrono from "chrono-node";
import { addCalendarDays, calendarParts, dayLabel, zonedTime } from "./time.js";

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export type DateRange = {
  start: Date;
  end: Date;
  label: string;
  phrase: string;
};

export type ParsedDates = {
  ranges: DateRange[];
  assumptions: string[];
};

type Span = [number, number];

function overlaps(spans: Span[], start: number, end: number): boolean {
  return spans.some(([from, to]) => start < to && end > from);
}

function weekdayIndex(name: string): number {
  return WEEKDAYS.indexOf(name.toLowerCase());
}

function rangeFor(
  year: number,
  month: number,
  day: number,
  timeZone: string,
  phrase: string,
): DateRange {
  const start = zonedTime(year, month, day, 0, 0, 0, timeZone);
  const next = addCalendarDays(year, month, day, 1);
  const end = zonedTime(next.year, next.month, next.day, 0, 0, 0, timeZone);
  return {
    start,
    end,
    label: dayLabel(year, month, day, timeZone),
    phrase,
  };
}

function mostRecentWeekday(
  now: Date,
  timeZone: string,
  target: number,
  includeToday: boolean,
): { year: number; month: number; day: number } {
  const today = calendarParts(now, timeZone);
  const todayIndex = weekdayIndex(today.weekday);
  let delta = (todayIndex - target + 7) % 7;
  if (delta === 0 && !includeToday) delta = 7;
  return addCalendarDays(today.year, today.month, today.day, -delta);
}

function resolveMonthDay(
  now: Date,
  timeZone: string,
  month: number,
  day: number,
  year: number | null,
  yearCertain: boolean,
): { year: number; month: number; day: number } {
  const today = calendarParts(now, timeZone);
  const chosenYear = year ?? today.year;
  if (yearCertain && year != null) return { year: chosenYear, month, day };
  const start = zonedTime(chosenYear, month, day, 0, 0, 0, timeZone);
  if (start.getTime() > now.getTime()) {
    return { year: chosenYear - 1, month, day };
  }
  return { year: chosenYear, month, day };
}

export function parseDates(text: string, now: Date, timeZone: string): ParsedDates {
  const spans: Span[] = [];
  const found: DateRange[] = [];

  const take = (pattern: RegExp, build: (match: RegExpMatchArray) => DateRange | null) => {
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (overlaps(spans, start, end)) continue;
      const range = build(match);
      if (!range) continue;
      spans.push([start, end]);
      found.push(range);
    }
  };

  const weekday = WEEKDAYS.join("|");
  take(new RegExp(`\\blast\\s+(${weekday})\\b`, "gi"), (match) => {
    const when = mostRecentWeekday(now, timeZone, weekdayIndex(match[1]), false);
    return rangeFor(when.year, when.month, when.day, timeZone, match[0]);
  });
  take(new RegExp(`\\bthis\\s+(${weekday})\\b`, "gi"), (match) => {
    const when = mostRecentWeekday(now, timeZone, weekdayIndex(match[1]), true);
    return rangeFor(when.year, when.month, when.day, timeZone, match[0]);
  });
  take(new RegExp(`\\b(?:on\\s+)?(${weekday})\\b`, "gi"), (match) => {
    const when = mostRecentWeekday(now, timeZone, weekdayIndex(match[1]), true);
    return rangeFor(when.year, when.month, when.day, timeZone, match[0]);
  });

  const masked = text
    .split("")
    .map((char, index) => (spans.some(([from, to]) => index >= from && index < to) ? " " : char))
    .join("");
  const today = calendarParts(now, timeZone);
  const reference = new Date(today.year, today.month - 1, today.day, 12, 0, 0);
  const withoutPresent = masked.replace(/\b(today|tomorrow)\b/gi, (word) => " ".repeat(word.length));
  for (const result of chrono.parse(withoutPresent, reference, { forwardDate: false })) {
    const month = result.start.get("month");
    const day = result.start.get("day");
    if (month == null || day == null) continue;
    const index = result.index;
    const end = index + result.text.length;
    if (overlaps(spans, index, end)) continue;
    const when = resolveMonthDay(
      now,
      timeZone,
      month,
      day,
      result.start.get("year"),
      result.start.isCertain("year"),
    );
    spans.push([index, end]);
    found.push(rangeFor(when.year, when.month, when.day, timeZone, result.text));
  }

  const seen = new Set<string>();
  const ranges: DateRange[] = [];
  for (const range of found) {
    const key = range.start.toISOString();
    if (seen.has(key)) continue;
    seen.add(key);
    ranges.push(range);
  }
  ranges.sort((a, b) => a.start.getTime() - b.start.getTime());

  return {
    ranges,
    assumptions: ranges.map((range) => `"${range.phrase}" is ${range.label}`),
  };
}
