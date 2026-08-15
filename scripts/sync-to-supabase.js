const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const dataFile = path.join(__dirname, '..', 'data', 'db.json');

if (!supabaseUrl || !supabaseKey) {
  console.error(
    'Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY).',
  );
  process.exit(1);
}

async function main() {
  const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const response = await fetch(
    `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/app_state?on_conflict=id`,
    {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        id: 'main',
        data,
        updated_at: new Date().toISOString(),
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase sync failed (${response.status}): ${text}`);
  }

  console.log(
    `Synced ${data.suppliers?.length || 0} suppliers, ${data.molds?.length || 0} molds, ${data.orders?.length || 0} orders.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
