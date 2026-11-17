// Nomes usados pela integração oficial Supabase ↔ Vercel.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function supabaseConfigurado() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export function urlPublica(path: string | null | undefined) {
  if (!path || !SUPABASE_URL) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/publico/${path}`;
}
