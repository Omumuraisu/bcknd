import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const rawConnectionString = process.env.DATABASE_URL;

if (!rawConnectionString) {
    throw new Error("DATABASE_URL is not set");
}

const allowInsecureSsl = process.env.ALLOW_INSECURE_DB_SSL === "true";
const connectionUrl = new URL(rawConnectionString);

// Keep runtime behavior explicit across pg/pg-connection-string versions.
const sslmode = connectionUrl.searchParams.get("sslmode");
if (!sslmode) {
    connectionUrl.searchParams.set("sslmode", "verify-full");
}

if (allowInsecureSsl) {
    connectionUrl.searchParams.set("sslmode", "no-verify");
    // eslint-disable-next-line no-console
    console.warn(
        "ALLOW_INSECURE_DB_SSL=true: TLS certificate verification is disabled for DB connection"
    );
}

const connectionString = connectionUrl.toString();

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

export { prisma };
