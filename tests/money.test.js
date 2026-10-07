import { test, expect, describe } from "bun:test";
import { CKB } from "./helpers.js";

describe("money", () => {
  test("reads dollars and cents into cents", () => {
    expect(CKB.cents("$312.47")).toBe(31247);
    expect(CKB.cents("$0.02")).toBe(2);
    expect(CKB.cents("$1,234.56")).toBe(123456);
    expect(CKB.cents("$12,345,678.90")).toBe(1234567890);
    expect(CKB.cents("$1234.56")).toBe(123456);
    expect(CKB.cents("  $6.00\n")).toBe(600);
  });

  test("refuses three decimals", () => {
    // Read as a thousands group, "$1.234" would be off by a thousand.
    expect(CKB.cents("$1.234")).toBeNull();
  });

  test("refuses any other shape", () => {
    for (const text of ["$1.2", "$1", "1.23", "$12,34.56", "$1,2345.00", "$0,123.00", "$-1.00", "-$1.00", "1.00 $", "", "$"]) {
      expect(CKB.cents(text)).toBeNull();
    }
  });

  test("writes cents the way Card Kingdom prints them", () => {
    expect(CKB.dollars(31247)).toBe("$312.47");
    expect(CKB.dollars(2)).toBe("$0.02");
    expect(CKB.dollars(0)).toBe("$0.00");
    expect(CKB.dollars(123456)).toBe("$1,234.56");
    expect(CKB.dollars(100000000)).toBe("$1,000,000.00");
    expect(CKB.dollars(-520)).toBe("-$5.20");
  });

  test("reads back what it writes", () => {
    for (const cents of [0, 1, 99, 100, 99999, 100000, 123456789]) {
      expect(CKB.cents(CKB.dollars(cents))).toBe(cents);
    }
  });
});

describe("dates", () => {
  test("reads a date with a time", () => {
    expect(CKB.when("Mar 14, 2026 10:36 AM")).toEqual({ year: 2026, month: 3, day: 14, hour: 10, minute: 36 });
  });

  test("reads a date with no time", () => {
    // How a sale's Received date is printed.
    expect(CKB.when("Mar 5, 2026")).toEqual({ year: 2026, month: 3, day: 5, hour: null, minute: null });
  });

  test("reads a padded hour", () => {
    expect(CKB.when("Apr 3, 2026 03:15 PM")).toEqual({ year: 2026, month: 4, day: 3, hour: 15, minute: 15 });
  });

  test("12 AM is midnight and 12 PM is noon", () => {
    expect(CKB.when("Jan 1, 2026 12:05 AM").hour).toBe(0);
    expect(CKB.when("Jan 1, 2026 12:05 PM").hour).toBe(12);
    expect(CKB.when("Dec 31, 2025 11:58 PM").hour).toBe(23);
    expect(CKB.when("Jan 1, 2026 01:00 AM").hour).toBe(1);
  });

  test("reads every month", () => {
    const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    names.forEach((name, i) => {
      expect(CKB.when(name + " 1, 2026").month).toBe(i + 1);
    });
  });

  test("takes the cell's whitespace as it comes", () => {
    expect(CKB.when("\n  Mar  5,\n 2026 ")).toEqual({ year: 2026, month: 3, day: 5, hour: null, minute: null });
  });

  test("refuses an unknown month or shape", () => {
    for (const text of ["Mar. 5, 2026", "March 5, 2026", "mar 5, 2026", "Foo 5, 2026", "5 Mar 2026", "2026-03-05", "Mar 5 2026", "Mar 5, 26", "Mar 5, 2026 10:36", ""]) {
      expect(CKB.when(text)).toBeNull();
    }
  });

  test("refuses a day the month does not have", () => {
    expect(CKB.when("Sep 31, 2026")).toBeNull();
    expect(CKB.when("Sep 0, 2026")).toBeNull();
    expect(CKB.when("Feb 29, 2025")).toBeNull();
    expect(CKB.when("Feb 29, 2024").day).toBe(29);
    expect(CKB.when("Feb 29, 1900")).toBeNull();
    expect(CKB.when("Feb 29, 2000").day).toBe(29);
  });

  test("refuses a time a 12-hour clock does not have", () => {
    for (const text of ["Mar 5, 2026 00:30 AM", "Mar 5, 2026 13:00 PM", "Mar 5, 2026 10:60 AM"]) {
      expect(CKB.when(text)).toBeNull();
    }
  });
});
