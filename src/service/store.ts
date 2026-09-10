import {mkdirSync, readFileSync, writeFileSync} from "fs";
import {join} from "path";
import {EduarteAPI} from "../api/eduarte-api";
import {EduarteAuth} from "../api/eduarte-auth";
import {SchoolDay} from "../api/objects/schoolDay";
import {Subject} from "../api/objects/subject";
import {AgendaView} from "../api/objects/agendaView";
import {toDateKey} from "../api/utils";
import {Config} from "../config";
import {classifyDays} from "./classify";

export interface Snapshot {
    days: SchoolDay[];
    lastSuccess?: Date;
    lastAttempt?: Date;
    lastError?: string;
}

interface PersistedSubject extends Omit<Subject, "startTimeObject" | "endTimeObject"> {
    startTimeObject?: string;
    endTimeObject?: string;
}

interface PersistedDay {
    dateString: string;
    dateObject: string;
    dateKey: string;
    subjects: PersistedSubject[];
}

interface PersistedState {
    version: 1;
    lastSuccess?: string;
    days: PersistedDay[];
}

/**
 * Keeps the scraped agenda in memory and on disk.
 *
 * The portal only exposes the window it happens to be showing, so days are
 * merged by date instead of replaced wholesale. That way the calendar feed keeps
 * showing past lessons (and the absence status recorded for them) after the
 * portal has moved on to the next week.
 */
export class AgendaStore {
    private readonly config: Config;
    private readonly auth: EduarteAuth;
    private api: EduarteAPI | undefined;
    private readonly days = new Map<string, SchoolDay>();
    private readonly statePath: string;

    private lastSuccess: Date | undefined;
    private lastAttempt: Date | undefined;
    private lastError: string | undefined;
    private inFlight: Promise<void> | undefined;
    private timer: NodeJS.Timeout | undefined;
    private stopped = false;

    constructor(config: Config) {
        this.config = config;
        this.auth = new EduarteAuth(
            config.portalUrl,
            config.headless,
            config.saveData,
            config.disableSandbox,
            config.dataDir
        );

        mkdirSync(config.dataDir, {recursive: true});
        this.statePath = join(config.dataDir, "agenda.json");
        this.load();
    }

    snapshot(): Snapshot {
        const stored = [...this.days.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
        // labelled on the way out, so changing the configured names takes effect
        // without waiting for the next scrape.
        const days = classifyDays(stored, this.config.placementNames);
        return {
            days,
            lastSuccess: this.lastSuccess,
            lastAttempt: this.lastAttempt,
            lastError: this.lastError,
        };
    }

    /** Refreshes once, then keeps refreshing on the configured interval. */
    async start(): Promise<void> {
        await this.refresh();
        this.scheduleNext();
    }

    stop() {
        this.stopped = true;
        if (this.timer) clearTimeout(this.timer);
    }

    /** Runs a refresh, joining an already running one instead of stacking. */
    refresh(): Promise<void> {
        if (!this.inFlight) {
            this.inFlight = this.doRefresh().finally(() => {
                this.inFlight = undefined;
            });
        }
        return this.inFlight;
    }

    private scheduleNext() {
        if (this.stopped) return;

        const minutes = this.lastError ? this.config.retryInterval : this.config.refreshInterval;
        this.timer = setTimeout(async () => {
            await this.refresh();
            this.scheduleNext();
        }, Math.max(1, minutes) * 60_000);
        this.timer.unref?.();
    }

    private async doRefresh(): Promise<void> {
        this.lastAttempt = new Date();

        try {
            const api = await this.getApi();
            let agenda: SchoolDay[];
            let navigated: boolean;

            try {
                ({days: agenda, navigated} = await api.getAgendaWeeks(this.config.weeksAhead));
            } catch (first) {
                // a stale session yields a login page instead of the agenda; retry once
                // with fresh cookies before giving up.
                this.log(`First agenda attempt failed (${first}), re-authenticating.`);
                await this.authenticate();
                ({days: agenda, navigated} = await (await this.getApi()).getAgendaWeeks(this.config.weeksAhead));
            }

            if (!navigated && this.config.weeksAhead > 1) {
                console.warn(
                    "The portal ignored the date filter, so only the current week was read."
                    + " Set weeks_ahead to 1 to silence this."
                );
            }

            this.merge(agenda);
            this.prune();
            this.lastSuccess = new Date();
            this.lastError = undefined;
            this.save();

            const lessons = agenda.reduce((total, day) => total + day.subjects.length, 0);
            console.log(`Agenda refreshed: ${agenda.length} day(s), ${lessons} lesson(s).`);
        } catch (error) {
            this.lastError = `${error instanceof Error ? error.message : error}`;
            console.error(`Agenda refresh failed: ${this.lastError}`);
            // drop the session so the next attempt logs in from scratch.
            this.api = undefined;
        }
    }

    private async getApi(): Promise<EduarteAPI> {
        if (!this.api) await this.authenticate();
        return this.api!;
    }

    private async authenticate(): Promise<void> {
        if (this.config.authCookie && !this.api) {
            const api = new EduarteAPI(this.config.portalUrl, this.config.authCookie);
            if (await api.isSessionValid()) {
                this.log("Reusing AUTH_COOKIE from the configuration.");
                this.api = api;
                return;
            }
            this.log("AUTH_COOKIE is no longer valid, logging in.");
        }

        console.log("Logging into Eduarte...");
        const cookie = this.config.isMicrosoftLogin
            ? await this.auth.loginMicrosoft(this.config.email, this.config.password, this.config.totpSecret ?? null)
            : await this.auth.loginEduarte(this.config.email, this.config.password);

        if (this.api) {
            this.api.setAuthCookie(cookie);
        } else {
            this.api = new EduarteAPI(this.config.portalUrl, cookie);
        }

        // the parser needs the list view; the portal remembers the last used view
        // per session, so this has to be set again after every login.
        try {
            await this.api.setAgendaView(AgendaView.LIST);
        } catch (error) {
            this.log(`Could not switch the agenda to list view: ${error}`);
        }

        console.log("Logged into Eduarte.");
    }

    private merge(agenda: SchoolDay[]) {
        for (const day of agenda) {
            // an empty day usually means a holiday; keep it so the feed can drop
            // lessons that were cancelled, but never let it wipe a known day when
            // the scrape was only partially rendered.
            const existing = this.days.get(day.dateKey);
            if (existing && day.subjects.length === 0 && existing.subjects.length > 0) {
                this.log(`Day ${day.dateKey} came back empty; keeping ${existing.subjects.length} known lesson(s).`);
                continue;
            }
            this.days.set(day.dateKey, day);
        }
    }

    private prune() {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - this.config.historyDays);
        const cutoffKey = toDateKey(cutoff);

        for (const key of this.days.keys()) {
            if (key < cutoffKey) this.days.delete(key);
        }
    }

    private load() {
        let raw: string;
        try {
            raw = readFileSync(this.statePath, "utf8");
        } catch {
            return;
        }

        try {
            const state: PersistedState = JSON.parse(raw);
            for (const day of state.days) {
                this.days.set(day.dateKey, {
                    dateString: day.dateString,
                    dateObject: new Date(day.dateObject),
                    dateKey: day.dateKey,
                    subjects: day.subjects.map(subject => ({
                        ...subject,
                        startTimeObject: subject.startTimeObject ? new Date(subject.startTimeObject) : undefined,
                        endTimeObject: subject.endTimeObject ? new Date(subject.endTimeObject) : undefined,
                    })),
                });
            }
            if (state.lastSuccess) this.lastSuccess = new Date(state.lastSuccess);
            console.log(`Loaded ${this.days.size} stored school day(s) from ${this.statePath}.`);
        } catch (error) {
            console.error(`Could not read ${this.statePath}, starting empty: ${error}`);
        }
    }

    private save() {
        const state: PersistedState = {
            version: 1,
            lastSuccess: this.lastSuccess?.toISOString(),
            days: [...this.days.values()].map(day => ({
                dateString: day.dateString,
                dateObject: day.dateObject.toISOString(),
                dateKey: day.dateKey,
                subjects: day.subjects.map(subject => ({
                    ...subject,
                    startTimeObject: subject.startTimeObject?.toISOString(),
                    endTimeObject: subject.endTimeObject?.toISOString(),
                })),
            })),
        };

        try {
            writeFileSync(this.statePath, JSON.stringify(state), "utf8");
        } catch (error) {
            console.error(`Could not persist the agenda to ${this.statePath}: ${error}`);
        }
    }

    private log(message: string) {
        if (this.config.debug) console.log(message);
    }
}
