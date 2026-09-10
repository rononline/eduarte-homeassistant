import {strict as assert} from "assert";
import {test} from "node:test";
import {convertDate, toDateKey} from "./utils";

test("resolves the year from the reference date", () => {
    const date = convertDate("dinsdag 1 september", new Date(2026, 7, 29));
    assert.equal(toDateKey(date), "2026-09-01");
});

test("uses the weekday to stay on the right side of the year boundary", () => {
    // early January, looking back at the last school day of December.
    const december = convertDate("donderdag 31 december", new Date(2027, 0, 4));
    assert.equal(toDateKey(december), "2026-12-31");

    // late December, looking ahead to the first school day of January.
    const january = convertDate("maandag 5 januari", new Date(2025, 11, 30));
    assert.equal(toDateKey(january), "2026-01-05");
});

test("accepts an explicit year and extra punctuation", () => {
    assert.equal(toDateKey(convertDate("maandag, 1 september 2025")), "2025-09-01");
});

test("rejects titles it cannot parse", () => {
    assert.throws(() => convertDate("geen lessen"), /Could not parse agenda date/);
});
