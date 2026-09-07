import { varrerPrazos } from "../src/lib/varredura";
import { pool } from "../src/lib/db";

console.log(await varrerPrazos());
await pool.end();
