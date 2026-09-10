import {SchoolDay} from "../api/objects/schoolDay";
import {Subject, SubjectKind} from "../api/objects/subject";

/**
 * Decides whether an agenda entry is a lesson or a work placement.
 *
 * Matching is on the name rather than on "has no teacher and no room", because
 * an unstaffed lesson would otherwise silently drop out of the lesson sensors.
 * The list is configurable so other whole-day entries can be added later.
 */
export function kindOf(subject: Subject, placementNames: string[]): SubjectKind {
    const name = subject.name?.trim().toLowerCase();
    if (!name) return "lesson";
    return placementNames.some(candidate => candidate.toLowerCase() === name) ? "placement" : "lesson";
}

/** Returns the days with every subject labelled, leaving the input untouched. */
export function classifyDays(days: SchoolDay[], placementNames: string[]): SchoolDay[] {
    return days.map(day => ({
        ...day,
        subjects: day.subjects.map(subject => ({...subject, kind: kindOf(subject, placementNames)})),
    }));
}
