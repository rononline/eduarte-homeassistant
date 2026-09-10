import {loadConfig} from "./config";
import {AgendaStore} from "./service/store";
import {createBridgeServer} from "./service/server";

(async () => {
    const config = loadConfig();
    const store = new AgendaStore(config);

    const server = createBridgeServer(config, store);
    server.listen(config.port, () => {
        console.log(`Eduarte bridge listening on port ${config.port}.`);
        console.log(`  calendar: http://<host>:${config.port}/calendar.ics`);
        console.log(`  state:    http://<host>:${config.port}/state.json`);
    });

    const shutdown = () => {
        console.log("Shutting down.");
        store.stop();
        server.close(() => process.exit(0));
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);

    // the first scrape may take a while (browser login); the endpoints already
    // serve whatever was persisted from the previous run in the meantime.
    await store.start();
})();
