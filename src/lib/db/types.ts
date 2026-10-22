// Connection type only, so modules that receive a connection can name it without being able to
// open one (opening stays with publicDb() / adminDb(), ADR-0002).
export type { Sql } from "./client";
