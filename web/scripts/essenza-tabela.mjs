// Extrai da tabela de vendas da Essenza (convertida por xlsx-para-json.py) as informações técnicas de cada produto,
// SEM preços: referências, medidas (e medida da base nas mesas de jantar), combinações de acabamento, opções e observações.
// Grava <pasta>/tabela-extraida.json.
// Uso (dentro de web/): node scripts/essenza-tabela.mjs ../amostras/essenza
import fs from "node:fs";
import path from "node:path";

const [pasta] = process.argv.slice(2);
const abas = JSON.parse(fs.readFileSync(path.join(pasta, "tabela.json"), "utf8"));
const txt = (v) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());
const numero = (v) => /^-?\d+([.,]\d+)?$/.test(txt(v));
const ref = (v) => (numero(v) ? String(Math.round(Number(String(v).replace(",", ".")))) : /\d/.test(txt(v)) ? txt(v) : null);

// "2700x600x770", "1800 x 450 x 770h", "ø1200x760", "Ø 700 x 25" -> { rotulo (cm), l, p, a (mm) }
function medida(v, espelho = false) {
  const s = txt(v).toLowerCase().replace(/,/g, ".").replace(/mm|h\b/g, "");
  const redondo = /[øØ⌀]/.test(txt(v));
  const n = (s.match(/\d+(\.\d+)?/g) || []).map(Number);
  if (n.length < 2) return null;
  let l, p, a;
  if (redondo && n.length === 2) [l, p, a] = [n[0], n[0], n[1]];
  else if (n.length >= 3) [l, p, a] = n;
  else [l, p, a] = [n[0], null, n[1]];
  // espelhos: a tabela traz altura x largura x espessura (ou ø x espessura); vira L x P x A como o resto
  if (espelho) {
    if (redondo && n.length === 2) [l, p, a] = [n[0], n[1], n[0]];
    else if (n.length >= 3) { const o = [...n.slice(0, 3)].sort((x, y) => x - y); [l, p, a] = [o[1], o[0], o[2]]; }
  }
  const cm = (x) => (x == null ? null : +(x / 10).toFixed(1));
  const fmt = (x) => String(cm(x)).replace(".", ",");
  const rotulo = redondo && n.length === 2 ? (espelho ? `ø${fmt(l)} x ${fmt(p)}` : `ø${fmt(l)} x ${fmt(a)}`) : [l, p, a].filter((x) => x != null).map(fmt).join(" x ");
  return { rotulo, largura_mm: l, profundidade_mm: p, altura_mm: a };
}

// textos de cabeçalho de colunas de preço que são, na verdade, opções do produto
const OPCAO = [
  [/pre[cç]o com tecido fornecido/i, "Tecido fornecido pelo cliente"],
  [/pre[cç]o cartela tecido/i, "Tecido da cartela Essenza"],
  [/pre[cç]o cartela couri/i, "Couríssimo da cartela Essenza"],
];
const IGNORAR = /^(acabamento|valor|valores da planilha|configura.*|multiplicador|percentual.*|hist[oó]rico.*|data|%|ref\.?|modelo|modeo|descri[cç][aã]o|dimens[aã]o|medida da base|acabamento da base)$/i;
const opcao = (s) => {
  for (const [re, t] of OPCAO) if (re.test(s)) return t;
  return s;
};
// conserta colagens e erros de digitação comuns na tabela ("Carvalhosem Vidro", "Noqueira")
const limparTexto = (s) => s.replace(/([a-zà-ú])(sem|com) (vidro)/gi, "$1 $2 $3").replace(/Noqueira/g, "Nogueira").replace(/\s+/g, " ").trim();

const produtos = new Map();
const pegar = (nome, aba) => {
  const k = nome.toLowerCase();
  if (!produtos.has(k)) produtos.set(k, { nome, aba, referencias: new Set(), medidas: new Map(), revestimentos: new Set(), opcoes: new Set(), observacoes: new Set() });
  return produtos.get(k);
};

for (const [aba, linhas] of Object.entries(abas)) {
  if (!linhas.length || /^(capa|menu|plan\d)$/i.test(aba)) continue;
  // cabeçalho: linha com "Descrição" (abas de categoria) ou "Dimensão" (abas de mesa de jantar)
  // abas "Mesa X" (uma por mesa de jantar): a 1ª coluna é a medida, seja qual for o título (Modelo, Descrição, Dimensão)
  const ehMesaJantar = /^mesa\s/i.test(aba) && !/^mesas\s/i.test(aba);
  const iCab = linhas.findIndex((r) => r.some((c) => /^ref\.?$/i.test(txt(c))));
  if (iCab < 0) continue;
  const cab = linhas[iCab].map(txt);
  const col = (re) => cab.findIndex((c) => re.test(c));
  const cMed = ehMesaJantar ? cab.findIndex((c) => c) : col(/^mode/i);
  const cNome = col(/^descri/i);
  const cRef = col(/^ref/i);
  const cBase = col(/^medida da base/i);
  const cAcab = ehMesaJantar ? col(/^acabamento/i) : cRef + 1;
  const nomeMesa = ehMesaJantar ? `Mesa de Jantar ${aba.replace(/^Mesa\s+/i, "").replace(/\.$/, "")}` : null;
  // opções da mesa de jantar ficam no próprio cabeçalho (colunas depois do acabamento)
  const opcoesCab = ehMesaJantar ? cab.slice(cAcab + 1, cAcab + 4).filter((c) => c && !numero(c) && !IGNORAR.test(c)).map(opcao) : [];

  let atual = null;
  for (const r of linhas.slice(iCab + 1)) {
    const nome = ehMesaJantar ? nomeMesa : txt(r[cNome]);
    if (!nome) continue;
    atual = pegar(nome, aba);
    opcoesCab.forEach((o) => atual.opcoes.add(limparTexto(o)));
    if (cRef >= 0 && r[cRef] != null && ref(r[cRef])) atual.referencias.add(ref(r[cRef]));
    const m = cMed >= 0 ? medida(r[cMed], /espelho/i.test(aba)) : null;
    if (m) {
      const base = cBase >= 0 ? txt(r[cBase]) : "";
      const chave = m.rotulo + (base ? ` · base ${base}` : "");
      if (!atual.medidas.has(chave)) atual.medidas.set(chave, { ...m, ref: ref(r[cRef]), base: base || null });
    }
    const a = txt(r[cAcab]);
    if (!a) continue;
    if (/^obs/i.test(a) || /^metragem/i.test(a)) {
      const o = limparTexto(a.replace(/^obs\.?:?\s*/i, ""));
      if (o && !/^metragem d[eo] tecido:?$/i.test(o)) atual.observacoes.add(o);
      continue;
    }
    if (IGNORAR.test(a)) {
      // linha de cabeçalho do bloco: as colunas seguintes dizem as opções (ex.: Tampo sem/com Vidro)
      r.slice(cAcab + 1, cAcab + 5).map(txt).filter((c) => c && !numero(c) && !IGNORAR.test(c) && c !== a)
        .forEach((c) => atual.opcoes.add(limparTexto(opcao(c))));
      continue;
    }
    if (!numero(a)) atual.revestimentos.add(limparTexto(a));
  }
}

const saida = [...produtos.values()].map((p) => ({
  nome: p.nome, aba: p.aba, referencias: [...p.referencias],
  medidas: [...p.medidas.values()], revestimentos: [...p.revestimentos], opcoes: [...p.opcoes], observacoes: [...p.observacoes],
}));
fs.writeFileSync(path.join(pasta, "tabela-extraida.json"), JSON.stringify(saida, null, 1));
console.log(`Produtos na tabela: ${saida.length}`);
console.log(`Com medidas: ${saida.filter((p) => p.medidas.length).length} · com referência: ${saida.filter((p) => p.referencias.length).length} · com observações: ${saida.filter((p) => p.observacoes.length).length}`);
