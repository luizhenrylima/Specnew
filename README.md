# Specifica

Visualizador 3D de produtos para arquitetos: troca de acabamentos, medidas reais e downloads técnicos (DWG, Lumion, SketchUp...). Cada produto tem um link (`/p/<slug>`) que as lojas colam nos catálogos.

- `web/` — app Next.js (deploy na Vercel, Root Directory = `web`)
- `supabase/migrations/` — estrutura do banco e buckets do Storage

## Rodar localmente
```bash
cd web
npx vercel link
npx vercel env pull .env.local
npm run dev
```
