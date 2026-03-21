require('dotenv').config();
const { Client } = require('pg');

async function main() {
  const base = process.env.DATABASE_URL || '';
  const url = new URL(base);
  url.searchParams.set('sslmode', 'no-verify');

  console.log('start');
  const client = new Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 8000,
  });
  await client.connect();
  console.log('connected');
  const res = await client.query("select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name ilike '%account%' order by table_name, ordinal_position");
  console.log(JSON.stringify(res.rows, null, 2));
  await client.end();
  console.log('done');
}

main().catch((err) => {
  console.error('ERR', err?.stack || err?.message || err);
  process.exit(1);
});
