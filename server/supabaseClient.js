/**
 * Supabase client for the backend (uses Service Role key to bypass RLS).
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
}

// Admin client — bypasses RLS, used for server-side operations
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// Anon client for user-facing auth operations
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
export const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey);

export default supabaseAdmin;
