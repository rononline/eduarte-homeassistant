import {strict as assert} from "assert";
import {test} from "node:test";
import {AgendaStore} from "./store";
import {AbsenceStatus} from "../api/objects/absenceStatus";
import {SchoolDay} from "../api/objects/schoolDay";
import {Config} from "../config";
import {mkdtempSync} from "fs";
import {tmpdir} from "os";
import {join} from "path";

function store(): AgendaStore {
    const config = {
        portalUrl: "https://portaal.invalid",
        email: "x@y.nl",
        password: "x",
        isMicrosoftLogin: true,
        headless: true,
        disableSandbox: true,
        saveData: false,
        refreshInterval: 30,
        retryInterval: 5,
        port: 0,
        dataDir: mkdtempSync(join(tmpdir(), "eduarte-test-")),
        historyDays: 90,
        weeksAhead: 4,
        weeksBack: 2,
        calendarName: "Rooster",
        placementNames: ["BPV"],
        debug: false,
    } as Config;
    return new AgendaStore(config);
}

function day(status: AbsenceStatus, marker?: string): SchoolDay {
    return {
        dateString: "woensdag 30 september",
        dateObject: new Date(2026, 8, 30),
        dateKey: "2026-09-30",
        subjects: [{
            id: "2026-09-30-0830-rekenen",
            name: "Rekenen niveau 3",
            startTimeString: "8:30",
            endTimeString: "9:15",
            startTimeObject: new Date(2026, 8, 30, 8, 30),
            endTimeObject: new Date(2026, 8, 30, 9, 15),
            absenceStatus: status,
            absenceMarker: marker,
        }],
    };
}

// merge() is private; these drive it the way a refresh does.
function mergeInto(s: AgendaStore, ...days: SchoolDay[]) {
    (s as unknown as {merge(d: SchoolDay[]): void}).merge(days);
}
function statusOf(s: AgendaStore): AbsenceStatus {
    return s.snapshot().days[0].subjects[0].absenceStatus;
}

test("a re-read that reports nothing does not erase a recorded absence", () => {
    // the bug this guards: looking back over past weeks with a parser that no
    // longer sees the presence column wiped a day that was correctly ABSENT.
    const s = store();
    mergeInto(s, day(AbsenceStatus.ABSENT, "icon-absent-1"));
    mergeInto(s, day(AbsenceStatus.NOT_REGISTERED));

    assert.equal(statusOf(s), AbsenceStatus.ABSENT);
    assert.equal(s.snapshot().days[0].subjects[0].absenceMarker, "icon-absent-1");
});

test("the same holds for a recorded attendance", () => {
    const s = store();
    mergeInto(s, day(AbsenceStatus.PRESENT, "flaticon calendar-2 is-completed"));
    mergeInto(s, day(AbsenceStatus.NOT_REGISTERED));

    assert.equal(statusOf(s), AbsenceStatus.PRESENT);
});

test("a genuine correction is accepted", () => {
    // school changing its mind is real; only "nothing registered" is distrusted.
    const s = store();
    mergeInto(s, day(AbsenceStatus.ABSENT, "icon-absent-1"));
    mergeInto(s, day(AbsenceStatus.PRESENT, "flaticon calendar-2 is-completed"));

    assert.equal(statusOf(s), AbsenceStatus.PRESENT);
});

test("a first reading of nothing registered is stored as such", () => {
    const s = store();
    mergeInto(s, day(AbsenceStatus.NOT_REGISTERED));

    assert.equal(statusOf(s), AbsenceStatus.NOT_REGISTERED);
});
