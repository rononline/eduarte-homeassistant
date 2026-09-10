import {strict as assert} from "assert";
import {test} from "node:test";
import {classifyDays, kindOf} from "./classify";
import {AbsenceStatus} from "../api/objects/absenceStatus";
import {Subject} from "../api/objects/subject";

function subject(name: string | undefined): Subject {
    return {id: "x", name, absenceStatus: AbsenceStatus.NOT_REGISTERED};
}

test("recognises the work placement by name, case-insensitively", () => {
    assert.equal(kindOf(subject("BPV"), ["BPV"]), "placement");
    assert.equal(kindOf(subject(" bpv "), ["BPV"]), "placement");
    assert.equal(kindOf(subject("Nederlands 2F"), ["BPV"]), "lesson");
});

test("does not treat an unstaffed lesson as a placement", () => {
    // BPV happens to have no teacher and no room, but that is not the rule:
    // a lesson whose teacher is missing must still count as a lesson.
    const unstaffed: Subject = {...subject("Rekenen niveau 3"), teacher: undefined, location: undefined};
    assert.equal(kindOf(unstaffed, ["BPV"]), "lesson");
});

test("falls back to lesson for entries without a name", () => {
    assert.equal(kindOf(subject(undefined), ["BPV"]), "lesson");
});

test("labels a whole day without mutating the input", () => {
    const days = [{
        dateString: "vrijdag 4 september",
        dateObject: new Date(2026, 8, 4),
        dateKey: "2026-09-04",
        subjects: [subject("BPV"), subject("Mentoruur")],
    }];

    const labelled = classifyDays(days, ["BPV"]);

    assert.deepEqual(labelled[0].subjects.map(s => s.kind), ["placement", "lesson"]);
    assert.equal(days[0].subjects[0].kind, undefined, "the original must not be touched");
});
