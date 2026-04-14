import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const rawConnectionString = process.env.DATABASE_URL;

if (!rawConnectionString) {
    throw new Error("DATABASE_URL is not set");
}

const isProduction = process.env.NODE_ENV === "production";
const allowInsecureSsl = process.env.ALLOW_INSECURE_DB_SSL === "true";
const requireStrictSsl = process.env.REQUIRE_STRICT_DB_SSL === "true";
const connectionUrl = new URL(rawConnectionString);

// Keep runtime behavior explicit across pg/pg-connection-string versions.
const sslmode = connectionUrl.searchParams.get("sslmode");
if (!sslmode) {
  const defaultSslMode = isProduction || requireStrictSsl ? "verify-full" : "no-verify";
  connectionUrl.searchParams.set("sslmode", defaultSslMode);

  if (defaultSslMode === "no-verify") {
    // eslint-disable-next-line no-console
    console.warn(
      "No sslmode in DATABASE_URL. Defaulting to sslmode=no-verify for local development. " +
        "Set REQUIRE_STRICT_DB_SSL=true to enforce certificate verification."
    );
  }
}

if (allowInsecureSsl) {
    connectionUrl.searchParams.set("sslmode", "no-verify");
    // eslint-disable-next-line no-console
    console.warn(
        "ALLOW_INSECURE_DB_SSL=true: TLS certificate verification is disabled for DB connection"
    );
}

// Fail fast when host/network is unreachable to keep errors actionable.
if (!connectionUrl.searchParams.get("connect_timeout")) {
  connectionUrl.searchParams.set("connect_timeout", "8");
}

const connectionString = connectionUrl.toString();

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const createPrismaClient = () => {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}