"use client";

import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

// Cliente para componentes que rodam no navegador (ex.: visualizador 3D).
export function criarClienteNavegador() {
  return createBrowserClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);
}
