"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { useConfigurador, type AcabamentoVisual } from "./Configurador";
import { EVENTO_3D_PRONTO } from "./TelaCarregamento";

type Props = {
  url: string;
  // Medidas reais em mm, usadas nas cotas. Se ausentes, usa a caixa do modelo.
  medidasMm?: { largura?: number | null; profundidade?: number | null; altura?: number | null };
};

const fmt = (mm: number) => `${(mm / 10).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} cm`;

// Coordenadas de textura em metros, por projeção de caixa (cada face usa o plano do seu eixo dominante).
// Assim a textura do acabamento sai no tamanho real, independente do UV original do modelo.
function geometriaComUvReal(geo: THREE.BufferGeometry, escala: THREE.Vector3) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const pos = g.getAttribute("position");
  const uv = new Float32Array(pos.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i).multiply(escala);
    b.fromBufferAttribute(pos, i + 1).multiply(escala);
    c.fromBufferAttribute(pos, i + 2).multiply(escala);
    n.subVectors(b, a).cross(c.clone().sub(a));
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    [a, b, c].forEach((p, k) => {
      const [u, v] = ay >= ax && ay >= az ? [p.x, p.z] : ax >= az ? [p.z, p.y] : [p.x, p.y];
      uv[(i + k) * 2] = u;
      uv[(i + k) * 2 + 1] = v;
    });
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

export default function Visualizador3D({ url, medidasMm }: Props) {
  const caixaRef = useRef<HTMLDivElement>(null);
  const [estado, setEstado] = useState<"carregando" | "pronto" | "erro">("carregando");
  const [cotas, setCotas] = useState(true);
  const cotasRef = useRef<THREE.Group | null>(null);
  const resetRef = useRef<() => void>(() => {});
  const config = useConfigurador();
  const porMaterial = config?.porMaterial;
  // material original do GLB -> malhas que o usam (com geometria original e a versão com UV real)
  const malhasRef = useRef(new Map<string, { malha: THREE.Mesh; original: THREE.Material; geo: THREE.BufferGeometry; geoReal?: THREE.BufferGeometry }[]>());
  const cacheRef = useRef(new Map<string, THREE.MeshPhysicalMaterial>());
  const texLoader = useRef(new THREE.TextureLoader());

  useEffect(() => {
    const caixa = caixaRef.current;
    if (!caixa) return;
    let w = caixa.clientWidth, h = caixa.clientHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    caixa.appendChild(renderer.domElement);

    const rotulos = new CSS2DRenderer();
    rotulos.setSize(w, h);
    Object.assign(rotulos.domElement.style, { position: "absolute", inset: "0", pointerEvents: "none" });
    caixa.appendChild(rotulos.domElement);

    const cena = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    cena.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    const camera = new THREE.PerspectiveCamera(35, w / h, 0.01, 1000);
    const controles = new OrbitControls(camera, renderer.domElement);
    controles.enableDamping = true;
    controles.maxPolarAngle = Math.PI / 2 - 0.02; // não deixa a câmera passar para baixo do piso

    const luz = new THREE.DirectionalLight(0xffffff, 1.6);
    luz.castShadow = true;
    luz.shadow.mapSize.set(2048, 2048);
    cena.add(luz, new THREE.HemisphereLight(0xffffff, 0xb0b0b0, 0.6));

    let raf = 0;
    let vivo = true;

    new GLTFLoader().load(
      url,
      (gltf) => {
        if (!vivo) return;
        const obj = gltf.scene;
        malhasRef.current.clear();
        obj.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.castShadow = true; m.receiveShadow = true;
          const mat = m.material as THREE.Material;
          const lista = malhasRef.current.get(mat.name) ?? [];
          lista.push({ malha: m, original: mat, geo: m.geometry });
          malhasRef.current.set(mat.name, lista);
        });

        // Coloca o produto apoiado no piso, centralizado.
        const box = new THREE.Box3().setFromObject(obj);
        const centro = box.getCenter(new THREE.Vector3());
        obj.position.sub(new THREE.Vector3(centro.x, box.min.y, centro.z));
        cena.add(obj);
        box.setFromObject(obj);
        const tam = box.getSize(new THREE.Vector3());
        const raio = tam.length() / 2;

        // Piso que só recebe sombra.
        const piso = new THREE.Mesh(new THREE.PlaneGeometry(raio * 8, raio * 8), new THREE.ShadowMaterial({ opacity: 0.18 }));
        piso.rotation.x = -Math.PI / 2;
        piso.receiveShadow = true;
        cena.add(piso);

        luz.position.set(raio * 1.5, raio * 3, raio * 2);
        const s = luz.shadow.camera as THREE.OrthographicCamera;
        s.left = s.bottom = -raio * 1.5; s.right = s.top = raio * 1.5; s.near = 0.01; s.far = raio * 10;
        s.updateProjectionMatrix();

        // Cotas: largura (x), profundidade (z), altura (y).
        const L = medidasMm?.largura ?? tam.x * 1000;
        const P = medidasMm?.profundidade ?? tam.z * 1000;
        const A = medidasMm?.altura ?? tam.y * 1000;
        const g = new THREE.Group();
        const mat = new THREE.LineBasicMaterial({ color: 0x3a3a3c, transparent: true, opacity: 0.55 });
        const off = raio * 0.08;
        const linha = (a: THREE.Vector3, b: THREE.Vector3, texto: string) => {
          g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), mat));
          const el = document.createElement("div");
          el.textContent = texto;
          el.className = "rounded-full bg-white px-2.5 py-1 text-[11px] font-medium tracking-wide text-[#3a3a3c] shadow-[0_1px_6px_rgba(0,0,0,0.08)]";
          const r = new CSS2DObject(el);
          r.position.copy(a.clone().add(b).multiplyScalar(0.5));
          g.add(r);
        };
        const { min, max } = box;
        linha(new THREE.Vector3(min.x, 0, max.z + off), new THREE.Vector3(max.x, 0, max.z + off), fmt(L));
        linha(new THREE.Vector3(max.x + off, 0, min.z), new THREE.Vector3(max.x + off, 0, max.z), fmt(P));
        linha(new THREE.Vector3(max.x + off, 0, max.z + off), new THREE.Vector3(max.x + off, max.y, max.z + off), fmt(A));
        cena.add(g);
        cotasRef.current = g;

        const enquadrar = () => {
          const dist = raio / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.1;
          const dir = new THREE.Vector3(0.9, 0.6, 1.3).normalize();
          controles.target.set(0, tam.y * 0.4, 0);
          camera.position.copy(controles.target).addScaledVector(dir, dist);
          camera.near = raio / 100; camera.far = raio * 100;
          camera.updateProjectionMatrix();
          controles.minDistance = raio * 0.6;
          controles.maxDistance = raio * 6;
          controles.update();
        };
        resetRef.current = enquadrar;
        enquadrar();
        setEstado("pronto");
        // espera o primeiro quadro desenhado antes de tirar a tela de carregamento
        requestAnimationFrame(() => requestAnimationFrame(() => window.dispatchEvent(new Event(EVENTO_3D_PRONTO))));
      },
      undefined,
      () => {
        if (!vivo) return;
        setEstado("erro");
        window.dispatchEvent(new Event(EVENTO_3D_PRONTO));
      },
    );

    const loop = () => {
      raf = requestAnimationFrame(loop);
      controles.update();
      renderer.render(cena, camera);
      rotulos.render(cena, camera);
    };
    loop();

    const ro = new ResizeObserver(() => {
      w = caixa.clientWidth; h = caixa.clientHeight;
      camera.aspect = w / h; camera.updateProjectionMatrix();
      renderer.setSize(w, h); rotulos.setSize(w, h);
    });
    ro.observe(caixa);

    return () => {
      vivo = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controles.dispose();
      pmrem.dispose();
      renderer.dispose();
      caixa.replaceChildren();
    };
  }, [url, medidasMm?.largura, medidasMm?.profundidade, medidasMm?.altura]);

  useEffect(() => {
    if (cotasRef.current) cotasRef.current.visible = cotas;
  }, [cotas, estado]);

  // Aplica os acabamentos escolhidos: troca o material das malhas de cada parte; sem escolha, volta ao original.
  useEffect(() => {
    if (estado !== "pronto") return;
    const material = (a: AcabamentoVisual) => {
      const chave = a.id + (a.verniz ? ":v" : "") + a.rugosidade;
      let m = cacheRef.current.get(chave);
      if (m) return m;
      m = new THREE.MeshPhysicalMaterial({
        color: a.textura ? 0xffffff : new THREE.Color(a.cor ?? "#cccccc"),
        roughness: a.rugosidade, metalness: a.metalico,
        clearcoat: a.verniz ? 1 : 0, clearcoatRoughness: 0.08,
        side: THREE.DoubleSide,
      });
      if (a.textura) {
        const t = texLoader.current.load(a.textura, () => { m!.needsUpdate = true; });
        t.colorSpace = THREE.SRGBColorSpace;
        // espelhado: as amostras do fornecedor não emendam sozinhas, e a repetição espelhada esconde a costura
        t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
        t.anisotropy = 8;
        const w = (a.larguraCm ?? 30) / 100, h = (a.alturaCm ?? a.larguraCm ?? 30) / 100;
        t.repeat.set(1 / w, 1 / h);
        m.map = t;
      }
      cacheRef.current.set(chave, m);
      return m;
    };
    for (const [nome, lista] of malhasRef.current) {
      const a = porMaterial?.[nome];
      for (const item of lista) {
        if (!a) {
          item.malha.material = item.original;
          item.malha.geometry = item.geo;
          continue;
        }
        if (a.textura && !item.geoReal) {
          item.malha.updateWorldMatrix(true, false);
          item.geoReal = geometriaComUvReal(item.geo, new THREE.Vector3().setFromMatrixScale(item.malha.matrixWorld));
        }
        item.malha.geometry = a.textura ? item.geoReal! : item.geo;
        item.malha.material = material(a);
      }
    }
  }, [porMaterial, estado]);

  const botao = (ativo = false) =>
    `inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-xs font-medium transition ${
      ativo ? "bg-grafite text-white" : "text-grafite hover:bg-nevoa"
    }`;

  return (
    <div className="relative h-full w-full overflow-hidden bg-[radial-gradient(ellipse_at_50%_35%,#ffffff_0%,#f3f3f3_55%,#e7e7e7_100%)]">
      <div ref={caixaRef} className="absolute inset-0 touch-none" />
      {estado === "carregando" && (
        <div className="absolute inset-0 grid place-items-center">
          <span className="flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-pedra">
            <span className="h-4 w-4 animate-spin rounded-full border border-pedra/40 border-t-grafite" />
            Carregando modelo 3D
          </span>
        </div>
      )}
      {estado === "erro" && (
        <div className="absolute inset-0 grid place-items-center text-sm text-pedra">Não foi possível carregar o modelo.</div>
      )}
      {estado === "pronto" && (
        <div className="absolute inset-x-0 bottom-4 flex justify-center px-3">
          <div className="flex max-w-full gap-1 overflow-x-auto rounded-full bg-white/90 p-1 shadow-[0_2px_16px_rgba(0,0,0,0.08)] backdrop-blur">
            <button onClick={() => setCotas((v) => !v)} aria-pressed={cotas} className={botao(cotas)}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden><path d="M1 10h12M1 8v4M13 8v4M4 10V9M7 10V8.5M10 10V9" /></svg>
              Medidas
            </button>
            <button onClick={() => resetRef.current()} className={botao()}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden><path d="M2 5V2h3M9 2h3v3M12 9v3H9M5 12H2V9" /><circle cx="7" cy="7" r="1.5" /></svg>
              Centralizar
            </button>
            {config && Object.keys(config.escolhas).length > 0 && (
              <button onClick={config.limpar} className={botao()}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden><path d="M2.5 7a4.5 4.5 0 1 0 1.3-3.2M2.5 2v2.5H5" /></svg>
                Original
              </button>
            )}
          </div>
        </div>
      )}
      {estado === "pronto" && (
        <p className="pointer-events-none absolute left-5 top-5 hidden text-[10px] uppercase tracking-[0.2em] text-pedra sm:block">
          Arraste para girar · role para aproximar
        </p>
      )}
    </div>
  );
}
