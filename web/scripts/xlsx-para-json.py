# Lê um .xlsx sem bibliotecas externas (zip + XML) e grava todas as abas como listas de linhas em JSON.
# Mantém células mescladas repetindo o valor nas células cobertas.
# python.exe -I xlsx-para-json.py <arquivo.xlsx> <saida.json>
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
arq, saida = sys.argv[1], sys.argv[2]
z = zipfile.ZipFile(arq)

compart = []
if "xl/sharedStrings.xml" in z.namelist():
    for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
        compart.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))

wb = ET.fromstring(z.read("xl/workbook.xml"))
rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
alvo = {r.get("Id"): r.get("Target") for r in rels}


def col_idx(ref):
    letras = re.match(r"[A-Z]+", ref).group(0)
    n = 0
    for ch in letras:
        n = n * 26 + ord(ch) - 64
    return n - 1


resultado = {}
for sh in wb.find("m:sheets", NS):
    nome = sh.get("name")
    caminho = "xl/" + alvo[sh.get("{%s}id" % NS["r"])].lstrip("/").replace("xl/", "")
    raiz = ET.fromstring(z.read(caminho))
    linhas = {}
    for row in raiz.iter("{%s}row" % NS["m"]):
        r = int(row.get("r")) - 1
        for c in row.findall("m:c", NS):
            v = c.find("m:v", NS)
            t = c.get("t")
            if t == "s" and v is not None:
                val = compart[int(v.text)]
            elif t == "inlineStr":
                val = "".join(x.text or "" for x in c.iter("{%s}t" % NS["m"]))
            else:
                val = v.text if v is not None else None
            if val not in (None, ""):
                linhas.setdefault(r, {})[col_idx(c.get("r"))] = val.strip() if isinstance(val, str) else val
    # células mescladas
    mc = raiz.find("m:mergeCells", NS)
    if mc is not None:
        for m in mc:
            a, b = m.get("ref").split(":")
            r0, c0 = int(re.search(r"\d+", a).group()) - 1, col_idx(a)
            r1, c1 = int(re.search(r"\d+", b).group()) - 1, col_idx(b)
            val = linhas.get(r0, {}).get(c0)
            if val is None:
                continue
            for rr in range(r0, r1 + 1):
                for cc in range(c0, c1 + 1):
                    linhas.setdefault(rr, {}).setdefault(cc, val)
    if not linhas:
        resultado[nome] = []
        continue
    nmax = max(max(l) for l in linhas.values()) + 1
    resultado[nome] = [[linhas[r].get(c) for c in range(nmax)] for r in sorted(linhas)]
json.dump(resultado, open(saida, "w", encoding="utf-8"), ensure_ascii=False)
for k, v in resultado.items():
    print(f"ABA {k}: {len(v)} linhas")
