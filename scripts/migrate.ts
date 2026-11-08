import { migrate, database } from "../src/lib/server/db";
await migrate();
console.log("SQLite schema is up to date.");
await database().end();
