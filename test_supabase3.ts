import "dotenv/config";
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { data, error } = await supabase.from('rasters').select('*');
  console.log('Data count:', data?.length);
  console.log('Data:', data?.map(d => d.tipo_dado));
}

test();
