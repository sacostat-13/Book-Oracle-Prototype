import {
  createClient
} from '@supabase/supabase-js';

const url =
  import.meta.env.VITE_SUPABASE_URL;
const anonKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !anonKey) {
  console.warn(
    '[oracle] Supabase env vars missing. Copy .env.example to .env.local and fill in your values.'
  );
}

export const supabase = createClient(url || 'http://localhost', anonKey || 'placeholder');