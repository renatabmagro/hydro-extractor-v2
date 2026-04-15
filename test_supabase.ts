import "dotenv/config";
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { data, error } = await supabase
    .from('bacias')
    .insert([{
      nome: 'Teste Bacia',
      geometria: { type: 'Point', coordinates: [0, 0] },
      area_km2: 10
    }])
    .select()
    .single();

  console.log('Data:', data);
  console.log('Error:', error);
}

test();
