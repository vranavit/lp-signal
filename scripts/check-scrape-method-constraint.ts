import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );
  const { data, error } = await supabase
    .from('plans')
    .select('name, scrape_method');
  if (error) { console.error(error); process.exit(1); }
  const methods = new Set(data?.map(p => p.scrape_method).filter(Boolean));
  console.log('Distinct scrape_method values currently in plans:');
  methods.forEach(m => console.log(' ', m));
}

main();
