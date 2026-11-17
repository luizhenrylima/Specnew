import "server-only";

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

// Leitura pública (respeita RLS: só o que está publicado).
export function criarClientePublico() {
  return createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
}

// Escrita administrativa (cadastro de produtos, uploads, conversões).
// Nunca importe isto em código que vai para o navegador.
export function criarClienteAdmin() {
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!chave) throw new Error("SUPABASE_SERVICE_ROLE_KEY não configurada");
  return createClient(SUPABASE_URL!, chave, {
    auth: { persistSession: false },
  });
}
