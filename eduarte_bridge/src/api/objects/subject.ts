import {AbsenceStatus} from "./absenceStatus";

/**
 * Not everything on the agenda is a lesson. BPV (the work placement) occupies a
 * whole day and would otherwise dominate "next lesson" and "lesson in progress".
 */
type SubjectKind = "lesson" | "placement";

interface Subject {
    /** Set when the agenda is read; defaults to a lesson. */
    kind?: SubjectKind;
    /** Stable identifier, used as the iCalendar UID so events survive refreshes. */
    id: string;
    name?: string
    location?: string;
    className?: string
    startTimeString?: string;
    endTimeString?: string;
    startTimeObject?: Date;
    endTimeObject?: Date;
    teacher?: string;
    /** Lesson hours as shown by the portal, e.g. "1-10". */
    lessonHours?: string;
    homework?: string;
    absenceStatus: AbsenceStatus;
    /** Raw class of the presence icon, so an unrecognised marker stays visible. */
    absenceMarker?: string;
}

export {Subject, SubjectKind};
