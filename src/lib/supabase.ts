import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

/** Browser-safe Supabase client. The anon key is public; never put a service-role key here. */
let supabaseClient = null;
if (supabaseUrl && supabaseAnonKey) {
  try {
    const parsedUrl = new URL(supabaseUrl);
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') throw new Error('Unsupported Supabase URL protocol.');
    supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    });
  } catch {
    console.error('Supabase Auth frontend configuration is invalid.');
  }
}

export const supabase = supabaseClient;

export const supabaseConfigured = Boolean(supabase);
