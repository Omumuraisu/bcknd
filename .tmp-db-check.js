require('dotenv').config();
const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  const res = await client.query(`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name ilike '%account%'
    order by table_name, ordinal_position
  `);

  console.log(JSON.stringify(res.rows, null, 2));
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
