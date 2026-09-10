import {SchoolDay} from "../api/objects/schoolDay";
import {Subject} from "../api/objects/subject";
import {AbsenceStatus} from "../api/objects/absenceStatus";
import {toDateKey} from "../api/utils";
import {Snapshot} from "./store";

export interface LessonState {
    id: string;
    kind: "lesson" | "placement";
    name: string | null;
    location: string | null;
    class: string | null;
    teacher: string | null;
    start: string | null;
    end: string | null;
    start_time: string | null;
    end_time: string | null;
    date: string;
    absence_status: AbsenceStatus;
    /** Raw presence icon class; surfaces an unexpected marker instead of hiding it. */
    absence_marker: string | null;
    homework: string | null;
}

export interface HomeworkItem {
    date: string;
    subject: string | null;
    text: string;
}

export interface DayState {
    date: string;
    lesson_count: number;
    first_start: string | null;
    last_end: string | null;
    lessons: LessonState[];
    /** True when a work placement covers this day. */
    on_placement: boolean;
    placement: LessonState | null;
}

export interface State {
    generated_at: string;
    status: "ok" | "stale" | "error" | "starting";
    last_update: string | null;
    last_attempt: string | null;
    last_error: string | null;
    today: DayState;
    tomorrow: DayState;
    current_lesson: LessonState | null;
    next_lesson: LessonState | null;
    absence: {
        today_absent: number;
        today_present: number;
        today_not_registered: number;
        week_absent: number;
        total_absent: number;
        last_absence: LessonState | null;
        /** Absences in the past seven days. */
        recent_absent_lessons: LessonState[];
        /** Every stored absence, newest first; the store keeps `history_days`. */
        absent_lessons: LessonState[];
    };
    homework: HomeworkItem[];
    upcoming: LessonState[];
}

/** Upper bound on the absence list handed to Home Assistant as an attribute. */
const MAX_ABSENCE_HISTORY = 50;

/** Lessons go stale when a refresh has not succeeded for this long. */
const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

function toLesson(day: SchoolDay, subject: Subject): LessonState {
    return {
        id: subject.id,
        kind: subject.kind ?? "lesson",
        name: subject.name || null,
        location: subject.location || null,
        class: subject.className || null,
        teacher: subject.teacher || null,
        start: subject.startTimeObject?.toISOString() ?? null,
        end: subject.endTimeObject?.toISOString() ?? null,
        start_time: subject.startTimeString || null,
        end_time: subject.endTimeString || null,
        date: day.dateKey,
        absence_status: subject.absenceStatus,
        absence_marker: subject.absenceMarker ?? null,
        homework: subject.homework || null,
    };
}

function dayState(days: SchoolDay[], dateKey: string) {
    const day = days.find(candidate => candidate.dateKey === dateKey);
    const entries = day ? day.subjects.map(subject => toLesson(day, subject)) : [];
    // the placement fills a whole day; counting it as a lesson would make every
    // BPV day look like a school day with one very long lesson.
    const lessons = entries.filter(entry => entry.kind === "lesson");
    const placements = entries.filter(entry => entry.kind === "placement");

    const starts = lessons.map(lesson => lesson.start).filter((value): value is string => !!value);
    const ends = lessons.map(lesson => lesson.end).filter((value): value is string => !!value);

    return {
        date: dateKey,
        lesson_count: lessons.length,
        first_start: starts.length ? starts.reduce((a, b) => (a < b ? a : b)) : null,
        last_end: ends.length ? ends.reduce((a, b) => (a > b ? a : b)) : null,
        lessons,
        on_placement: placements.length > 0,
        placement: placements[0] ?? null,
    };
}

export function buildState(snapshot: Snapshot, now: Date = new Date()): State {
    const {days, lastSuccess, lastAttempt, lastError} = snapshot;

    const all: LessonState[] = [];
    for (const day of days) {
        for (const subject of day.subjects) all.push(toLesson(day, subject));
    }
    all.sort((a, b) => (a.start ?? a.date).localeCompare(b.start ?? b.date));

    const nowIso = now.toISOString();
    const todayKey = toDateKey(now);
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowKey = toDateKey(tomorrow);

    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoKey = toDateKey(weekAgo);

    const lessonsOnly = all.filter(entry => entry.kind === "lesson");

    const current = lessonsOnly.find(lesson =>
        lesson.start !== null && lesson.end !== null && lesson.start <= nowIso && lesson.end > nowIso
    ) ?? null;

    const next = lessonsOnly.find(lesson => lesson.start !== null && lesson.start > nowIso) ?? null;

    const todayLessons = all.filter(lesson => lesson.date === todayKey);
    const absentLessons = all.filter(lesson => lesson.absence_status === AbsenceStatus.ABSENT);

    let status: State["status"];
    if (!lastSuccess) {
        status = lastError ? "error" : "starting";
    } else if (lastError) {
        status = now.getTime() - lastSuccess.getTime() > STALE_AFTER_MS ? "error" : "stale";
    } else {
        status = "ok";
    }

    return {
        generated_at: nowIso,
        status,
        last_update: lastSuccess?.toISOString() ?? null,
        last_attempt: lastAttempt?.toISOString() ?? null,
        last_error: lastError ?? null,
        today: dayState(days, todayKey),
        tomorrow: dayState(days, tomorrowKey),
        current_lesson: current,
        next_lesson: next,
        absence: {
            today_absent: todayLessons.filter(l => l.absence_status === AbsenceStatus.ABSENT).length,
            today_present: todayLessons.filter(l => l.absence_status === AbsenceStatus.PRESENT).length,
            today_not_registered: todayLessons.filter(l => l.absence_status === AbsenceStatus.NOT_REGISTERED).length,
            week_absent: absentLessons.filter(l => l.date >= weekAgoKey && l.date <= todayKey).length,
            total_absent: absentLessons.length,
            last_absence: absentLessons.filter(l => l.date <= todayKey).at(-1) ?? null,
            recent_absent_lessons: absentLessons.filter(l => l.date >= weekAgoKey && l.date <= todayKey),
            // newest first, and capped so a long history cannot bloat the
            // attribute that Home Assistant has to carry on every poll.
            absent_lessons: absentLessons.filter(l => l.date <= todayKey).reverse().slice(0, MAX_ABSENCE_HISTORY),
        },
        homework: all
            .filter(lesson => lesson.homework && lesson.date >= todayKey)
            .map(lesson => ({date: lesson.date, subject: lesson.name, text: lesson.homework as string})),
        upcoming: lessonsOnly.filter(lesson => lesson.start !== null && lesson.start > nowIso).slice(0, 20),
    };
}
