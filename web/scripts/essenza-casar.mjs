// Liga os produtos lidos do site da Essenza (site.json) aos modelos convertidos dos .skp (arquivos.json),
// pelo nome do produto e pela categoria. Grava <pasta>/site-casado.json ({ slugDoModelo: produtoDoSite }) e lista o que sobrou.
// Uso (dentro de web/): node scripts/essenza-casar.mjs ../amostras/essenza
import fs from "node:fs";
import path from "node:path";

const [pasta] = process.argv.slice(2);
const site = JSON.parse(fs.readFileSync(path.join(pasta, "site.json"), "utf8"));
const arquivos = JSON.parse(fs.readFileSync(path.join(pasta, "arquivos.json"), "utf8"));
const slug = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// categoria do site -> prefixos de nome dos arquivos
const CAT = {
  "Aparadores": ["aparador"], "Cadeiras": ["cadeira"], "Bares": ["bar"], "Carro Bar": ["carro-bar"], "Buffet": ["buffet"],
  "Mesas Laterais & Apoio": ["mesa-lateral", "mesa-bistro"], "Escrivaninhas": ["escrivaninha"], "Cristaleira": ["cristaleira"],
  "Mesas de Centro": ["mesa-de-centro", "mesa-centro"], "Mesas de Cabeceira & Cômodas": ["mesa-de-cabeceira", "mesa-cabeceira", "comoda", "comcomoda", "criado-mudo"],
  "Poltronas": ["poltrona"], "Banquetas": ["banqueta"], "Bistrôs": ["mesa-bistro"], "Rack": ["rack"], "Sofa-Table": ["sofa-table", "aparador"],
  "Bancos": ["banco"], "Mancebos": ["mancebo"], "Penteadeira": ["penteadeira"], "Camas": ["cama"], "Luminárias": ["luminaria"],
  "Espelhos": ["espelho"], "Mesas de Jantar": ["mesa-de-jantar", "mesa-jantar"], "Pufes": ["puff", "pufe"], "Estantes": ["estante"],
};
const SUFIXOS = ["final", "faenza", "essenza"];

// nome do arquivo sem o prefixo da categoria ("mesa-de-jantar-bowl" -> "bowl")
function nucleo(s, prefixos) {
  for (const p of prefixos.sort((a, b) => b.length - a.length)) if (s.startsWith(p + "-")) return s.slice(p.length + 1);
  return null;
}
const limpo = (s) => s.split("-").filter((w) => !SUFIXOS.includes(w)).join("-");

const casado = {}, usados = new Set();
// 1) igual exato do núcleo do nome dentro da categoria; 2) mesmo nome com/sem "ii", "redonda/retangular" etc.
for (const passo of [0, 1]) {
  for (const p of site) {
    const prefs = CAT[p.categoria] ?? [];
    const alvo = slug(p.nome.replace(/\s*-\s*(aparadores|mesas? .*)$/i, ""));
    for (const a of arquivos) {
      if (casado[a.slug]) continue;
      const n = nucleo(a.slug, prefs);
      if (n == null) continue;
      const nn = limpo(n);
      const ok = passo === 0 ? nn === alvo : (nn.startsWith(alvo + "-") || alvo.startsWith(nn + "-"));
      if (ok && !(passo === 1 && usados.has(p.url))) {
        casado[a.slug] = p;
        usados.add(p.url);
      }
    }
  }
}
// 3) nome completo (o site às vezes inclui a categoria: "Cômoda Alabama"), com sinônimos do arquivo
const norm = (s) => slug(s).replace(/^comcomoda/, "comoda").replace(/^criado-mudo/, "mesa-de-cabeceira")
  .replace(/^mesa-cabeceira/, "mesa-de-cabeceira").split("-").filter((w) => !SUFIXOS.includes(w)).join("-");
for (const a of arquivos) {
  if (casado[a.slug]) continue;
  const p = site.find((x) => !usados.has(x.url) && norm(x.nome) === norm(a.slug));
  if (p) { casado[a.slug] = p; usados.add(p.url); }
}
// 4) grafias diferentes entre o arquivo e o site (conferidas à mão)
const MANUAL = { "carro-bar-ruote": "Route", "espelho-urca-organico": "Urca Orgânicos", "mesa-de-centro-chanell": "Chanel", "mesa-cannes": "Cannes" };
for (const [s, nome] of Object.entries(MANUAL)) {
  const p = site.find((x) => x.nome === nome);
  if (p && !casado[s]) { casado[s] = p; usados.add(p.url); }
}
fs.writeFileSync(path.join(pasta, "site-casado.json"), JSON.stringify(casado, null, 1));
const sem = arquivos.filter((a) => !casado[a.slug]).map((a) => a.slug);
console.log(`Modelos ligados a uma página do site: ${Object.keys(casado).length} de ${arquivos.length}`);
console.log(`Sem página (${sem.length}): ${sem.join(", ")}`);
