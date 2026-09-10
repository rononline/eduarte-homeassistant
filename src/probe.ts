/**
 * Debug helper: logs in, saves the raw agenda page and reports what the parser
 * makes of it. Use this when the portal changes and the selectors need updating.
 *
 *   npm run probe            fetch a fresh page and parse it
 *   npm run probe -- <file>  re-parse a previously saved page, without logging in
 */
import {readFileSync, writeFileSync} from "fs";
import {join} from "path";
import {loadConfig} from "./config";
import {EduarteAPI, parseAgenda} from "./api/eduarte-api";
import {EduarteAuth} from "./api/eduarte-auth";
import {AgendaView} from "./api/objects/agendaView";

(async () => {
    const config = loadConfig();
    const fileArgument = process.argv[2];
    let page: string;

    if (fileArgument) {
        page = readFileSync(fileArgument, "utf8");
        console.log(`Parsing ${fileArgument} (${page.length} bytes).`);
    } else {
        const auth = new EduarteAuth(config.portalUrl, config.headless, config.saveData, config.disableSandbox, config.dataDir);
        console.log("Logging in...");
        const cookie = config.isMicrosoftLogin
            ? await auth.loginMicrosoft(config.email, config.password, config.totpSecret ?? null)
            : await auth.loginEduarte(config.email, config.password);

        const api = new EduarteAPI(config.portalUrl, cookie);
        await api.setAgendaView(AgendaView.LIST);

        const walk = await api.getAgendaWeeks(config.weeksAhead);
        console.log(
            `Walked ${config.weeksAhead} week(s): ${walk.days.length} day(s)`
            + `${walk.navigated ? "" : " — the date filter did NOT take effect"}.`
        );
        for (const day of walk.days) {
            console.log(`\n${day.dateKey}  ${day.dateString}  (${day.subjects.length} lessons)`);
            for (const subject of day.subjects) {
                console.log(
                    `  ${subject.startTimeString}-${subject.endTimeString}  ${subject.name ?? "?"}`
                    + `  lokaal=${subject.location ?? "-"}  docent=${subject.teacher ?? "-"}`
                    + `  lesuren=${subject.lessonHours ?? "-"}  status=${subject.absenceStatus}`
                    + (subject.homework ? `  huiswerk="${subject.homework}"` : "")
                );
            }
        }
        console.log("");

        page = await api.getAgendaPage();

        const target = join(config.dataDir, "agenda-page.html");
        writeFileSync(target, page, "utf8");
        console.log(`Saved the agenda page to ${target} (${page.length} bytes).`);
    }

    try {
        const days = parseAgenda(page);
        console.log(`Parsed ${days.length} school day(s):`);
        for (const day of days) {
            console.log(`\n${day.dateKey}  ${day.dateString}  (${day.subjects.length} lessons)`);
            for (const subject of day.subjects) {
                console.log(
                    `  ${subject.startTimeString}-${subject.endTimeString}  ${subject.name ?? "?"}`
                    + `  lokaal=${subject.location ?? "-"}  docent=${subject.teacher ?? "-"}`
                    + `  lesuren=${subject.lessonHours ?? "-"}`
                    + `  status=${subject.absenceStatus}`
                    + (subject.homework ? `  huiswerk="${subject.homework}"` : "")
                );
            }
        }
    } catch (error) {
        console.error(`\nParsing failed: ${error}`);
        console.error("Open the saved HTML and check the .agenda-list / .agenda-title / .agenda-class selectors.");
        process.exitCode = 1;
    }
})();
