import {SchoolDay} from "../api/objects/schoolDay";
import {Subject} from "../api/objects/subject";
import {AbsenceStatus} from "../api/objects/absenceStatus";

const absenceLabels: Record<AbsenceStatus, string> = {
    [AbsenceStatus.PRESENT]: "Aanwezig",
    [AbsenceStatus.ABSENT]: "Absent",
    [AbsenceStatus.NOT_REGISTERED]: "Niet geregistreerd",
};

/** RFC 5545 text escaping: backslash, semicolon, comma and newlines. */
function escapeText(value: string): string {
    return value
        .replace(/\\/g, "\\\\")
        .replace(/;/g, "\\;")
        .replace(/,/g, "\\,")
        .replace(/\r?\n/g, "\\n");
}

/** RFC 5545 requires content lines to be folded at 75 octets. */
function fold(line: string): string {
    const bytes = Buffer.from(line, "utf8");
    if (bytes.length <= 75) return line;

    const parts: string[] = [];
    let offset = 0;
    let limit = 75;

    while (offset < bytes.length) {
        let end = Math.min(offset + limit, bytes.length);
        // never split a multi-byte character across a fold.
        while (end > offset && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
        parts.push(bytes.subarray(offset, end).toString("utf8"));
        offset = end;
        limit = 74; // continuation lines start with a space
    }

    return parts.join("\r\n ");
}

function toUtc(date: Date): string {
    return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function describe(subject: Subject): string {
    const lines: string[] = [];
    if (subject.teacher) lines.push(`Docent: ${subject.teacher}`);
    if (subject.className) lines.push(`Klas: ${subject.className}`);
    if (subject.lessonHours) lines.push(`Lesuren: ${subject.lessonHours}`);
    if (subject.location) lines.push(`Lokaal: ${subject.location}`);
    lines.push(`Aanwezigheid: ${absenceLabels[subject.absenceStatus]}`);
    if (subject.homework) lines.push("", `Huiswerk: ${subject.homework}`);
    return lines.join("\n");
}

export interface CalendarOptions {
    name: string;
    /** Timestamp used for DTSTAMP / LAST-MODIFIED. */
    stamp?: Date;
}

export function buildCalendar(days: SchoolDay[], options: CalendarOptions): string {
    const stamp = toUtc(options.stamp ?? new Date());

    const lines: string[] = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//eduarte-ha-bridge//NONSGML v2.0//NL",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        `X-WR-CALNAME:${escapeText(options.name)}`,
        "X-WR-TIMEZONE:Europe/Amsterdam",
    ];

    for (const day of days) {
        for (const subject of day.subjects) {
            if (!subject.startTimeObject || !subject.endTimeObject) continue;

            // zero-length lessons are rejected by some calendar clients.
            const end = subject.endTimeObject > subject.startTimeObject
                ? subject.endTimeObject
                : new Date(subject.startTimeObject.getTime() + 60_000);

            const summary = subject.name || subject.className || subject.location || "Les";

            lines.push(
                "BEGIN:VEVENT",
                `UID:${subject.id}@eduarte-ha-bridge`,
                `DTSTAMP:${stamp}`,
                `LAST-MODIFIED:${stamp}`,
                `DTSTART:${toUtc(subject.startTimeObject)}`,
                `DTEND:${toUtc(end)}`,
                `SUMMARY:${escapeText(summary)}`,
            );

            if (subject.location) lines.push(`LOCATION:${escapeText(subject.location)}`);
            lines.push(`DESCRIPTION:${escapeText(describe(subject))}`);
            lines.push(`CATEGORIES:${escapeText(absenceLabels[subject.absenceStatus])}`);
            lines.push(`X-EDUARTE-ABSENCE:${subject.absenceStatus}`);
            lines.push("END:VEVENT");
        }
    }

    lines.push("END:VCALENDAR");

    return lines.map(fold).join("\r\n") + "\r\n";
}
