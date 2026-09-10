import {strict as assert} from "assert";
import {test} from "node:test";
import {buildCalendar} from "./ical";
import {SchoolDay} from "../api/objects/schoolDay";
import {AbsenceStatus} from "../api/objects/absenceStatus";

function day(): SchoolDay {
    return {
        dateString: "dinsdag 1 september",
        dateObject: new Date(2026, 8, 1),
        dateKey: "2026-09-01",
        subjects: [{
            id: "2026-09-01-0830-nederlands",
            name: "Nederlands; groep A, deel 2",
            location: "A1.02",
            className: "MBO4A",
            teacher: "J. de Vries",
            startTimeString: "08:30",
            endTimeString: "09:20",
            startTimeObject: new Date(Date.UTC(2026, 8, 1, 6, 30)),
            endTimeObject: new Date(Date.UTC(2026, 8, 1, 7, 20)),
            homework: "Lees hoofdstuk 3",
            absenceStatus: AbsenceStatus.ABSENT,
        }],
    };
}

test("emits a valid VEVENT in UTC", () => {
    const ics = buildCalendar([day()], {name: "Rooster", stamp: new Date(Date.UTC(2026, 8, 1, 5, 0))});

    assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
    assert.match(ics, /\r\nEND:VCALENDAR\r\n$/);
    assert.match(ics, /UID:2026-09-01-0830-nederlands@eduarte-ha-bridge\r\n/);
    assert.match(ics, /DTSTART:20260901T063000Z\r\n/);
    assert.match(ics, /DTEND:20260901T072000Z\r\n/);
    assert.match(ics, /DTSTAMP:20260901T050000Z\r\n/);
    assert.match(ics, /X-EDUARTE-ABSENCE:ABSENT\r\n/);
});

test("escapes semicolons and commas in text values", () => {
    const ics = buildCalendar([day()], {name: "Rooster"});
    assert.match(ics, /SUMMARY:Nederlands\\; groep A\\, deel 2/);
});

test("folds long lines at 75 octets", () => {
    const long = day();
    long.subjects[0].homework = "x".repeat(300);
    const ics = buildCalendar([long], {name: "Rooster"});

    for (const line of ics.split("\r\n")) {
        assert.ok(Buffer.byteLength(line) <= 75, `line too long: ${line.slice(0, 40)}...`);
    }
    // a folded line continues with a single leading space.
    assert.match(ics, /\r\n x{10}/);
});

test("gives zero-length lessons a non-zero duration", () => {
    const broken = day();
    broken.subjects[0].endTimeObject = broken.subjects[0].startTimeObject;
    const ics = buildCalendar([broken], {name: "Rooster"});
    assert.match(ics, /DTEND:20260901T063100Z/);
});
