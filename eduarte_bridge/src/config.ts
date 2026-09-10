import {readFileSync} from "fs";
import {config as loadEnv} from "dotenv";

loadEnv();

/**
 * Home Assistant writes the add-on options here; running from a checkout there
 * is no such file and everything comes from the environment instead. Option keys
 * are the lower-cased environment names (PORTAL_URL -> portal_url).
 */
const optionsPath = process.env.OPTIONS_FILE || "/data/options.json";
const options: Record<string, unknown> = (() => {
    try {
        return JSON.parse(readFileSync(optionsPath, "utf8"));
    } catch {
        return {};
    }
})();

function raw(name: string): string | undefined {
    const option = options[name.toLowerCase()];
    if (option !== undefined && option !== null && option !== "") return String(option);

    const value = process.env[name];
    return value ? value : undefined;
}

function required(name: string): string {
    const value = raw(name);
    if (!value) throw new Error(`Missing required setting ${name} (add-on option ${name.toLowerCase()}).`);
    return value;
}

function optional(name: string): string | undefined {
    return raw(name);
}

function boolean(name: string, fallback: boolean): boolean {
    const value = raw(name);
    if (value === undefined) return fallback;
    return value === "true" || value === "1";
}

function number(name: string, fallback: number): number {
    const value = raw(name);
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`Setting ${name} is not a number: "${value}".`);
    return parsed;
}

export interface Config {
    portalUrl: string;
    email: string;
    password: string;
    totpSecret?: string;
    authCookie?: string;
    isMicrosoftLogin: boolean;
    headless: boolean;
    disableSandbox: boolean;
    saveData: boolean;
    /** Minutes between agenda refreshes. */
    refreshInterval: number;
    /** Minutes between refreshes while the last attempt is failing. */
    retryInterval: number;
    port: number;
    /** Optional shared secret; when set, requests must carry ?token= or a bearer header. */
    apiToken?: string;
    /** Directory for the persisted agenda history and browser profile. */
    dataDir: string;
    /** How many days of past lessons to keep in the calendar feed. */
    historyDays: number;
    /** How many weeks to walk forward through the agenda on each refresh. */
    weeksAhead: number;
    calendarName: string;
    /** Agenda entries with these names count as a work placement, not a lesson. */
    placementNames: string[];
    debug: boolean;
}

export function loadConfig(): Config {
    return {
        portalUrl: required("PORTAL_URL").replace(/\/+$/, ""),
        email: required("EDUARTE_EMAIL"),
        password: required("EDUARTE_PASSWORD"),
        totpSecret: optional("TOTP_SECRET"),
        authCookie: optional("AUTH_COOKIE"),
        isMicrosoftLogin: boolean("IS_MICROSOFT_LOGIN", true),
        headless: boolean("HEADLESS", true),
        disableSandbox: boolean("DISABLE_SANDBOX", false),
        saveData: boolean("SAVE_DATA", true),
        refreshInterval: number("REFRESH_INTERVAL", 30),
        retryInterval: number("RETRY_INTERVAL", 5),
        port: number("PORT", 8099),
        apiToken: optional("API_TOKEN"),
        dataDir: raw("DATA_DIR") || "./data",
        historyDays: number("HISTORY_DAYS", 90),
        weeksAhead: number("WEEKS_AHEAD", 4),
        calendarName: raw("CALENDAR_NAME") || "Rooster",
        placementNames: (raw("PLACEMENT_NAMES") ?? "BPV")
            .split(",")
            .map(name => name.trim())
            .filter(Boolean),
        debug: boolean("DEBUG", false),
    };
}
