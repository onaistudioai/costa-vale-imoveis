import { defineConfig } from "drizzle-kit";

export default defineConfig({
  // O cérebro tem schema Postgres próprio (`cerebro`) e mora em arquivo
  // separado, mas as migrations são as mesmas: um banco, dois territórios.
  schema: ["./src/lib/db/schema.ts", "./src/cerebro/schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
