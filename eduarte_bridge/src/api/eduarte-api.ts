import {HTMLElement, parse as parseHtml} from "node-html-parser";
import {convertDate, formatDate, toDateKey} from "./utils";
import {Subject} from "./objects/subject";
import {SchoolDay} from "./objects/schoolDay";
import {AbsenceReason} from "./objects/absenceReason";
import {AbsenceStatus} from "./objects/absenceStatus";
import {AgendaView} from "./objects/agendaView";

/**
 * Reads a Wicket AJAX endpoint straight out of the rendered page.
 *
 * The query string encodes the page version (`?<page>-<version>.<n>-<component>`),
 * which increases every time the page re-renders. Constructing it by hand works
 * exactly once; after that the guessed version is stale and the portal quietly
 * ignores the request. The page always advertises the current URL, so read it.
 */
function findAjaxUrl(page: string, component: string): string | undefined {
    const pattern = new RegExp(`"u":"\\.\\/agenda\\?([^"]*?-${component})(?:&(?:amp;)?op=\\d+)?"`);
    return pattern.exec(page)?.[1];
}

/** Trims a scraped value and turns blank ones into undefined. */
function clean(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

/** Builds a UID that stays the same across refreshes for the same lesson. */
function subjectId(dateKey: string, startTime: string, name: string): string {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    // the portal writes "7:30" as well as "13:15"; pad so the id does not change
    // if it ever starts zero-padding the hour.
    const time = startTime.replace(/^(\d):/, "0$1:").replace(":", "");
    return `${dateKey}-${time}-${slug || "les"}`;
}

/**
 * Parses the agenda page of the student portal.
 *
 * Kept separate from the HTTP layer so the selectors can be exercised against a
 * saved page (see `npm run probe`) without logging in.
 */
function parseAgenda(page: string, reference: Date = new Date()): SchoolDay[] {
    const html = parseHtml(page);
    const schoolDays: SchoolDay[] = [];

    const agenda = html.querySelector(".agenda-list");

    if (!agenda) throw new Error("Agenda element has not been found. Is the agenda view not on list mode?");

    const tables = agenda.querySelectorAll("table");
    const titles = agenda.querySelectorAll(".agenda-title");

    // holidays and weeks without lessons render the container but no days at all
    // ("Er zijn geen afspraken voor deze week"). That is a valid, empty result.
    if (tables.length === 0 && titles.length === 0) {
        return [];
    }

    if (tables.length === 0 || titles.length === 0) {
        throw new Error("The needed elements (tables & titles) are not found.");
    }

    titles.forEach((titleElement, index) => {
        const tableElement: HTMLElement | undefined = tables[index];
        if (!tableElement) return;

        const dateString = titleElement.textContent.trim();
        const dateObject = convertDate(dateString, reference);
        const dateKey = toDateKey(dateObject);
        const daySubjects: Subject[] = [];

        tableElement.querySelectorAll("tr").forEach((subjectElement) => {
            const classText = subjectElement.querySelector(".agenda-class")?.textContent.trim() || "";
            const startTimeString = subjectElement.querySelector(".agenda-time .top")?.textContent.trim() || "";
            const endTimeString = subjectElement.querySelector(".agenda-time .bottom")?.textContent.trim() || "";

            // rows without a time are separators or empty-day placeholders.
            if (!startTimeString) return;

            const teacherElement = subjectElement.querySelector(".agenda-teacher");
            const locationElement = subjectElement.querySelector(".agenda-location");

            let name: string | undefined;
            let location: string | undefined;
            let className: string | undefined;
            let teacher: string | undefined;

            if (teacherElement || locationElement) {
                // this portal gives every field its own element and .agenda-class
                // holds nothing but the name of the lesson or activity.
                name = clean(classText);
                teacher = clean(teacherElement?.textContent);
                location = clean(locationElement?.textContent);
            } else {
                // older layout packs "lokaal - vak - klas - docent" into one string.
                const parts = classText.split(" - ").map(part => part.trim());
                [location, name, className, teacher] = parts.map(clean);
            }

            const lessonHours = clean(subjectElement.querySelector(".agenda-item")?.textContent);

            const startTimeObject = applyTime(dateObject, startTimeString);
            const endTimeObject = applyTime(dateObject, endTimeString) || startTimeObject;

            const homework = subjectElement.querySelector(".agenda-homework")?.textContent.trim() || "";
            const {absenceStatus, absenceMarker} = readPresence(subjectElement);

            daySubjects.push({
                id: subjectId(dateKey, startTimeString, name || location || ""),
                lessonHours,
                name,
                location,
                className,
                startTimeString,
                endTimeString,
                startTimeObject,
                endTimeObject,
                teacher,
                homework,
                absenceStatus,
                absenceMarker,
            });
        });

        schoolDays.push({dateString, dateObject, dateKey, subjects: daySubjects});
    });

    return schoolDays;
}

/**
 * Reads the presence registration from its own cell.
 *
 * The portal leaves `.agenda-presence-icon` empty until something is registered,
 * and drops in an icon once it is — `is-completed` for present. Rather than
 * matching one known class for absent, anything else registered counts as not
 * present: missing a real absence is the failure that matters here, and the raw
 * class is kept so an unexpected marker is visible instead of silent.
 */
function readPresence(row: HTMLElement): {absenceStatus: AbsenceStatus; absenceMarker?: string} {
    const cell = row.querySelector(".agenda-presence-icon");
    // older layouts put the icon loose in the row instead of in its own cell.
    const scope = cell ?? row;
    const icon = scope.querySelector("i, span[class*=icon], span[class*=is-]");

    if (!icon) {
        return {absenceStatus: AbsenceStatus.NOT_REGISTERED};
    }

    const marker = icon.getAttribute("class")?.trim().replace(/\s+/g, " ");

    if (icon.classList.contains("is-completed")) {
        return {absenceStatus: AbsenceStatus.PRESENT, absenceMarker: marker};
    }

    return {absenceStatus: AbsenceStatus.ABSENT, absenceMarker: marker};
}

function applyTime(date: Date, timeString: string): Date | undefined {
    const match = /^(\d{1,2}):(\d{2})$/.exec(timeString);
    if (!match) return undefined;

    const result = new Date(date);
    result.setHours(parseInt(match[1], 10), parseInt(match[2], 10), 0, 0);
    return result;
}

class EduarteAPI {
    private readonly portalUrl: string;
    private readonly userAgent: string;
    private authCookie: string;
    private visitId: number | undefined;

    constructor(
        portalUrl: string,
        authCookie: string,
        userAgent: string = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
    ) {
        this.portalUrl = portalUrl.endsWith("/")
            ? portalUrl.substring(0, portalUrl.length - 1)
            : portalUrl;
        this.authCookie = authCookie;
        this.userAgent = userAgent;
    }

    async isSessionValid(): Promise<boolean> {
        let response = await fetch(this.portalUrl, {
            headers: this.getRequestHeaders(),
        });

        return response.url.includes(this.portalUrl);
    }

    setAuthCookie(authCookie: string) {
        this.authCookie = authCookie;
        this.visitId = undefined;
    }

    /** Switches the agenda to the given view. `getAgendaWeeks` does this itself. */
    async setAgendaView(agendaView: AgendaView) {
        const visitId = await this.getVisitId();
        const page = await this.requestPage(`${this.portalUrl}/agenda?${visitId}`);
        const path = findAjaxUrl(page, "filter-weergaveKiezer-choicesContainer-enumHiddenField");
        if (!path) throw new Error("Could not find the agenda view selector on the page.");
        await this.postFilter(visitId, path, 'filter:weergaveKiezer:choicesContainer:enumHiddenField', agendaView);
    }

    private async postFilter(visitId: string, ajaxPath: string, field: string, value: string) {
        await fetch(`${this.portalUrl}/agenda?${ajaxPath}&op=3`, {
            method: 'POST',
            headers: this.getRequestHeaders({
                'accept': 'application/xml, text/xml, */*; q=0.01',
                'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'referer': `${this.portalUrl}/agenda?${visitId}`,
                'wicket-ajax': 'true',
                'wicket-ajax-baseurl': `agenda?${visitId}`,
                'x-requested-with': 'XMLHttpRequest'
            }),
            body: new URLSearchParams({[field]: value})
        });
    }

    /** Raw HTML of the agenda page, for parsing and for offline debugging. */
    async getAgendaPage(): Promise<string> {
        const visitId = await this.getVisitId();
        return await this.requestPage(`${this.portalUrl}/agenda?${visitId}`);
    }

    async getAgenda(): Promise<SchoolDay[]> {
        return parseAgenda(await this.getAgendaPage());
    }

    /**
     * Walks the agenda forward a week at a time, starting from today.
     *
     * Everything runs on one page instance so the date filter sticks between
     * steps, and the filter URL is re-read from each render because its version
     * number changes as the page updates. If a step returns the same days as the
     * one before it the filter stopped taking effect, so it stops there.
     */
    async getAgendaWeeks(weeks: number, from: Date = new Date()): Promise<{days: SchoolDay[]; navigated: boolean}> {
        const visitId = await this.getVisitId();
        const url = `${this.portalUrl}/agenda?${visitId}`;

        let page = await this.requestPage(url);

        const viewPath = findAjaxUrl(page, "filter-weergaveKiezer-choicesContainer-enumHiddenField");
        if (viewPath) {
            await this.postFilter(visitId, viewPath, 'filter:weergaveKiezer:choicesContainer:enumHiddenField', AgendaView.LIST);
            page = await this.requestPage(url);
        }

        const collected = new Map<string, SchoolDay>();
        let previousKeys = "";
        let navigated = true;

        for (let week = 0; week < Math.max(1, weeks); week++) {
            const target = new Date(from);
            target.setDate(target.getDate() + week * 7);

            const datePath = findAjaxUrl(page, "filter-datum");
            if (!datePath) {
                navigated = false;
                break;
            }

            await this.postFilter(visitId, datePath, 'filter:datum', formatDate(target));
            page = await this.requestPage(url);

            const days = parseAgenda(page, target);
            const keys = days.map(day => day.dateKey).join(",");

            if (week > 0 && keys === previousKeys) {
                navigated = false;
                break;
            }

            for (const day of days) collected.set(day.dateKey, day);
            previousKeys = keys;
        }

        return {
            days: [...collected.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey)),
            navigated,
        };
    }

    async reportAbsence(reason: AbsenceReason | number, startDate: Date, endDate: Date) {
        let startDateString = formatDate(startDate);
        let endDateString = formatDate(endDate);
        let startTimeString = startDate.getHours() + ":" + startDate.getMinutes();
        let endTimeString = endDate.getHours() + ":" + endDate.getMinutes();
        let visitId = await this.getVisitId();
        if (endDate < startDate) {
            throw new Error("End date cannot be before start date.");
        }

        // opening the page is required for some reason.
        let parsedHtml = parseHtml(await this.requestPage(`${this.portalUrl}/presentie/presentie.overzicht?${visitId}`));

        let buttonId = parsedHtml.querySelector(".header-toolbar--action")?.id;

        if (!buttonId) {
            throw new Error("Could not find button ID.");
        }

        let openFormResponse = await fetch(`${this.portalUrl}/presentie/presentie.overzicht?${visitId}-1.0-header-contextButtonPanel-leftContainer-leftButtons-0-link`, {
                method: 'GET',
                headers: this.getRequestHeaders({
                    'accept': 'application/xml, text/xml, */*; q=0.01',
                    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'referer': `${this.portalUrl}/presentie/presentie.overzicht?${visitId}`,
                    'wicket-ajax': 'true',
                    'wicket-ajax-baseurl': 'presentie/presentie.overzicht',
                    'wicket-focusedelementid': buttonId,
                    'x-requested-with': 'XMLHttpRequest'
                })
            },
        );

        let formId = this.getFormId(await openFormResponse.text());

        if (!formId) {
            throw new Error("Could not get form ID.");
        }

        let saveFormResponse = await fetch(`${this.portalUrl}/presentie/presentie.overzicht?${visitId}-1.0-contextPopupPanel-opslaan`, {
            method: 'POST',
            headers: this.getRequestHeaders({
                'accept': 'application/xml, text/xml, */*; q=0.01',
                'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'referer': `${this.portalUrl}/presentie/presentie.overzicht?${visitId}`,
                'wicket-ajax': 'true',
                'wicket-ajax-baseurl': `presentie/presentie.overzicht?${visitId}`,
                'wicket-focusedelementid': formId,
                'x-requested-with': 'XMLHttpRequest'
            }),
            body: new URLSearchParams({
                'absentiemelding:fieldSetMarkup:inputFields:0:controlGroup:controlGroup_body:formField': reason.toString(),
                'absentiemelding:fieldSetMarkup:inputFields:1:controlGroup:controlGroup_body:formField': startDateString,
                'absentiemelding:fieldSetMarkup:inputFields:2:controlGroup:controlGroup_body:formField': startTimeString,
                'absentiemelding:fieldSetMarkup:inputFields:3:controlGroup:controlGroup_body:formField': endDateString,
                'absentiemelding:fieldSetMarkup:inputFields:4:controlGroup:controlGroup_body:formField': endTimeString,
                'contextPopupPanel:opslaan': '1'
            })
        });

        let saveFormHtml = parseHtml(this.getHtmlFromXml(await saveFormResponse.text()));

        let errors = saveFormHtml.querySelectorAll(".form--errors")
            .map(error => error.querySelector("p")?.textContent)
            .filter(error => error);

        if (errors && errors.length > 0) {
            throw new Error(`Server responded with errors: ${errors}`)
        }
    }

    private getHtmlFromXml(xmlString: string): string {
        // this might break sometime, but we'll see.
        return xmlString.split("![CDATA[")[1].split("]]")[0];
    }

    private getFormId(xmlString: string): string | undefined {
        let parsedHtml = parseHtml(this.getHtmlFromXml(xmlString));
        return parsedHtml.querySelector("form")?.id;
    }

    private async getVisitId() {
        if (!this.visitId) {
            let response = await fetch(this.portalUrl, {
                headers: this.getRequestHeaders(),
            });

            if (!response.url.includes(this.portalUrl)) {
                throw new Error("Failed to get visit ID. Is the session valid?");
            }

            this.visitId = +response.url.replace(`${this.portalUrl}/?`, "");
        }

        this.visitId++;

        return this.visitId.toString();
    }

    private async requestPage(url: string): Promise<string> {
        const response = await fetch(url.toString(), {
            headers: this.getRequestHeaders({
                referer: this.portalUrl,
                accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            }),
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch page. Status: ${response.status}`);
        }

        return await response.text();
    }

    private getRequestHeaders(additionalHeaders?: Record<string, string>): Record<string, string> {
        return {
            "accept-language": "nl,en-US;q=0.9,en;q=0.8,nl-NL;q=0.7,af;q=0.6",
            cookie: this.authCookie,
            origin: this.portalUrl,
            "user-agent": this.userAgent,
            ...additionalHeaders,
        };
    }
}

export {EduarteAPI, SchoolDay, Subject, parseAgenda, findAjaxUrl};
