import {strict as assert} from "assert";
import {test} from "node:test";
import {buildState} from "./state";
import {SchoolDay} from "../api/objects/schoolDay";
import {AbsenceStatus} from "../api/objects/absenceStatus";
import {Subject} from "../api/objects/subject";

function lesson(dateKey: string, start: Date, end: Date, status: AbsenceStatus, name: string, homework = "", kind: "lesson" | "placement" = "lesson"): Subject {
    return {
        id: `${dateKey}-${name}`,
        kind,
        name,
        location: "A1.02",
        className: "MBO4A",
        teacher: "J. de Vries",
        startTimeString: "08:30",
        endTimeString: "09:20",
        startTimeObject: start,
        endTimeObject: end,
        homework,
        absenceStatus: status,
    };
}

function days(): SchoolDay[] {
    return [
        {
            dateString: "maandag 31 augustus",
            dateObject: new Date(2026, 7, 31),
            dateKey: "2026-08-31",
            subjects: [lesson("2026-08-31", new Date(2026, 7, 31, 8, 30), new Date(2026, 7, 31, 9, 20), AbsenceStatus.ABSENT, "Rekenen")],
        },
        {
            dateString: "vrijdag 4 september",
            dateObject: new Date(2026, 8, 4),
            dateKey: "2026-09-04",
            subjects: [lesson("2026-09-04", new Date(2026, 8, 4, 8, 30), new Date(2026, 8, 4, 17, 0), AbsenceStatus.NOT_REGISTERED, "BPV", "", "placement")],
        },
        {
            dateString: "dinsdag 1 september",
            dateObject: new Date(2026, 8, 1),
            dateKey: "2026-09-01",
            subjects: [
                lesson("2026-09-01", new Date(2026, 8, 1, 8, 30), new Date(2026, 8, 1, 9, 20), AbsenceStatus.PRESENT, "Nederlands"),
                lesson("2026-09-01", new Date(2026, 8, 1, 9, 30), new Date(2026, 8, 1, 10, 20), AbsenceStatus.NOT_REGISTERED, "Engels", "Woordjes leren"),
            ],
        },
    ];
}

test("reports the current and next lesson", () => {
    const now = new Date(2026, 8, 1, 8, 45);
    const state = buildState({days: days(), lastSuccess: now}, now);

    assert.equal(state.current_lesson?.name, "Nederlands");
    assert.equal(state.next_lesson?.name, "Engels");
    assert.equal(state.today.date, "2026-09-01");
    assert.equal(state.today.lesson_count, 2);
    assert.equal(state.status, "ok");
});

test("counts absences for today and the past week", () => {
    const now = new Date(2026, 8, 1, 8, 45);
    const state = buildState({days: days(), lastSuccess: now}, now);

    assert.equal(state.absence.today_absent, 0);
    assert.equal(state.absence.today_present, 1);
    assert.equal(state.absence.today_not_registered, 1);
    assert.equal(state.absence.week_absent, 1);
    assert.equal(state.absence.last_absence?.name, "Rekenen");
});

test("only lists homework from today onwards", () => {
    const now = new Date(2026, 8, 1, 8, 45);
    const state = buildState({days: days(), lastSuccess: now}, now);

    assert.deepEqual(state.homework, [{date: "2026-09-01", subject: "Engels", text: "Woordjes leren"}]);
});

test("marks the data stale after a failed refresh and error once it is old", () => {
    const now = new Date(2026, 8, 1, 12, 0);

    const recent = buildState({days: days(), lastSuccess: new Date(2026, 8, 1, 11, 0), lastError: "boom"}, now);
    assert.equal(recent.status, "stale");

    const old = buildState({days: days(), lastSuccess: new Date(2026, 7, 30, 8, 0), lastError: "boom"}, now);
    assert.equal(old.status, "error");

    assert.equal(buildState({days: [], lastError: "boom"}, now).status, "error");
    assert.equal(buildState({days: []}, now).status, "starting");
});

test("keeps the work placement out of the lesson figures", () => {
    const now = new Date(2026, 8, 4, 10, 0); // midden in een BPV-dag
    const state = buildState({days: days(), lastSuccess: now}, now);

    assert.equal(state.today.lesson_count, 0, "BPV is not a lesson");
    assert.equal(state.today.on_placement, true);
    assert.equal(state.today.placement?.name, "BPV");
    assert.equal(state.current_lesson, null, "BPV must not show up as the current lesson");
    assert.equal(state.today.first_start, null);
});

test("looks past the placement for the next lesson", () => {
    const now = new Date(2026, 7, 31, 12, 0);
    const state = buildState({days: days(), lastSuccess: now}, now);

    assert.equal(state.next_lesson?.name, "Nederlands");
    assert.ok(state.upcoming.every(entry => entry.kind === "lesson"));
});

test("keeps a longer absence history alongside the weekly one", () => {
    const now = new Date(2026, 8, 1, 12, 0);
    const state = buildState({days: days(), lastSuccess: now}, now);

    // 31 augustus valt binnen beide vensters.
    assert.equal(state.absence.recent_absent_lessons.length, 1);
    assert.equal(state.absence.absent_lessons.length, 1);
    assert.equal(state.absence.absent_lessons[0].name, "Rekenen");
});

test("lists the longer history newest first and never in the future", () => {
    const now = new Date(2026, 8, 1, 12, 0);
    const extra = days();
    extra.push({
        dateString: "woensdag 2 september",
        dateObject: new Date(2026, 8, 2),
        dateKey: "2026-09-02",
        subjects: [lesson("2026-09-02", new Date(2026, 8, 2, 9, 0), new Date(2026, 8, 2, 10, 0), AbsenceStatus.ABSENT, "Toekomst")],
    });

    const state = buildState({days: extra, lastSuccess: now}, now);

    assert.ok(state.absence.absent_lessons.every(l => l.date <= "2026-09-01"), "morgen hoort er niet in");
    assert.equal(state.absence.absent_lessons[0].name, "Rekenen");
});
