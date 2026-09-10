import {createServer, IncomingMessage, Server, ServerResponse} from "http";
import {timingSafeEqual} from "crypto";
import {Config} from "../config";
import {AgendaStore} from "./store";
import {buildCalendar} from "./ical";
import {buildState} from "./state";

function tokenMatches(expected: string, provided: string | undefined): boolean {
    if (!provided) return false;
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    return a.length === b.length && timingSafeEqual(a, b);
}

function isAuthorised(config: Config, request: IncomingMessage, url: URL): boolean {
    if (!config.apiToken) return true;

    const header = request.headers.authorization;
    const bearer = header?.startsWith("Bearer ") ? header.slice(7) : undefined;

    return tokenMatches(config.apiToken, bearer)
        || tokenMatches(config.apiToken, url.searchParams.get("token") ?? undefined);
}

function send(response: ServerResponse, status: number, contentType: string, body: string) {
    response.writeHead(status, {
        "content-type": contentType,
        "content-length": Buffer.byteLength(body),
        "cache-control": "no-store",
    });
    response.end(body);
}

export function createBridgeServer(config: Config, store: AgendaStore): Server {
    return createServer(async (request, response) => {
        const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
        const path = url.pathname.replace(/\/+$/, "") || "/";

        // the watchdog needs to reach this without credentials.
        if (path === "/health") {
            const snapshot = store.snapshot();
            return send(response, 200, "application/json", JSON.stringify({
                ok: !!snapshot.lastSuccess,
                last_update: snapshot.lastSuccess?.toISOString() ?? null,
                last_error: snapshot.lastError ?? null,
                days: snapshot.days.length,
            }));
        }

        if (!isAuthorised(config, request, url)) {
            return send(response, 401, "application/json", JSON.stringify({error: "unauthorised"}));
        }

        try {
            switch (path) {
                case "/calendar.ics": {
                    const snapshot = store.snapshot();
                    const calendar = buildCalendar(snapshot.days, {
                        name: config.calendarName,
                        stamp: snapshot.lastSuccess,
                    });
                    return send(response, 200, "text/calendar; charset=utf-8", calendar);
                }

                case "/":
                case "/state.json": {
                    const state = buildState(store.snapshot());
                    return send(response, 200, "application/json; charset=utf-8", JSON.stringify(state, null, 2));
                }

                case "/refresh": {
                    if (request.method !== "POST") {
                        return send(response, 405, "application/json", JSON.stringify({error: "use POST"}));
                    }
                    await store.refresh();
                    const snapshot = store.snapshot();
                    return send(response, snapshot.lastError ? 502 : 200, "application/json", JSON.stringify({
                        ok: !snapshot.lastError,
                        last_update: snapshot.lastSuccess?.toISOString() ?? null,
                        last_error: snapshot.lastError ?? null,
                    }));
                }

                default:
                    return send(response, 404, "application/json", JSON.stringify({error: "not found"}));
            }
        } catch (error) {
            console.error(`Request for ${path} failed: ${error}`);
            return send(response, 500, "application/json", JSON.stringify({
                error: `${error instanceof Error ? error.message : error}`,
            }));
        }
    });
}
