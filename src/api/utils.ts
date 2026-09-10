const dayNames: Record<string, number> = {
    "zondag": 0,
    "maandag": 1,
    "dinsdag": 2,
    "woensdag": 3,
    "donderdag": 4,
    "vrijdag": 5,
    "zaterdag": 6,
};

const monthNames: Record<string, number> = {
    "januari": 0,
    "februari": 1,
    "maart": 2,
    "april": 3,
    "mei": 4,
    "juni": 5,
    "juli": 6,
    "augustus": 7,
    "september": 8,
    "oktober": 9,
    "november": 10,
    "december": 11,
};

/**
 * Parses a Dutch agenda title such as "maandag 1 september" into a Date.
 *
 * Eduarte omits the year, so it is derived from the reference date. The weekday
 * name acts as a checksum: of the candidate years only the one whose weekday
 * matches is kept, which keeps December/January agendas on the right side of
 * the year boundary.
 */
function convertDate(dutchDate: string, reference: Date = new Date()): Date {
    const parts = dutchDate.trim().toLowerCase().replace(/,/g, " ").split(/\s+/).filter(Boolean);

    let weekday: number | undefined;
    let day: number | undefined;
    let month: number | undefined;
    let year: number | undefined;

    for (const part of parts) {
        if (part in dayNames) {
            weekday = dayNames[part];
        } else if (part in monthNames) {
            month = monthNames[part];
        } else if (/^\d{4}$/.test(part)) {
            year = parseInt(part, 10);
        } else if (/^\d{1,2}$/.test(part)) {
            day = parseInt(part, 10);
        }
    }

    if (day === undefined || month === undefined) {
        throw new Error(`Could not parse agenda date: "${dutchDate}"`);
    }

    if (year !== undefined) {
        return new Date(year, month, day);
    }

    const referenceYear = reference.getFullYear();
    const candidates = [referenceYear - 1, referenceYear, referenceYear + 1]
        .map(candidateYear => new Date(candidateYear, month, day))
        // guard against e.g. 29 februari rolling over into March.
        .filter(date => date.getDate() === day && date.getMonth() === month);

    const matching = weekday === undefined
        ? candidates
        : candidates.filter(date => date.getDay() === weekday);

    const usable = matching.length > 0 ? matching : candidates;

    if (usable.length === 0) {
        throw new Error(`Could not resolve a year for agenda date: "${dutchDate}"`);
    }

    return usable.reduce((closest, date) =>
        Math.abs(date.getTime() - reference.getTime()) < Math.abs(closest.getTime() - reference.getTime())
            ? date
            : closest
    );
}

function formatDate(date: Date): string {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
}

/** Local calendar date as YYYY-MM-DD, used as a stable key for a school day. */
function toDateKey(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
}

export {convertDate, formatDate, toDateKey};
