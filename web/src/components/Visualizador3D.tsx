"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";

type Props = {
  url: string;
  // Medidas reais em mm, usadas nas cotas. Se ausentes, usa a caixa do modelo.
  medidasMm?: { largura?: number | null; profundidade?: number | null; altura?: number | null };
};

const fmt = (mm: number) => `${(mm / 10).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} cm`;

export default function Visualizador3D({ url, medidasMm }: Props) {
  const caixaRef = useRef<HTMLDivElement>(null);
  const [estado, setEstado] = useState<"carregando" | "pronto" | "erro">("carregando");
  const [cotas, setCotas] = useState(true);
  const cotasRef = useRef<THREE.Group | null>(null);
  const resetRef = useRef<() => void>(() => {});

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
        obj.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
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
        const mat = new THREE.LineBasicMaterial({ color: 0x2f6fde });
        const off = raio * 0.08;
        const linha = (a: THREE.Vector3, b: THREE.Vector3, texto: string) => {
          g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), mat));
          const el = document.createElement("div");
          el.textContent = texto;
          el.className = "rounded bg-white/90 px-1.5 py-0.5 text-[11px] font-medium text-[#2f6fde] shadow-sm";
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
      },
      undefined,
      () => vivo && setEstado("erro"),
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

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl bg-gradient-to-b from-neutral-50 to-neutral-200">
      <div ref={caixaRef} className="absolute inset-0 touch-none" />
      {estado === "carregando" && (
        <div className="absolute inset-0 grid place-items-center text-sm text-neutral-500">Carregando modelo 3D…</div>
      )}
      {estado === "erro" && (
        <div className="absolute inset-0 grid place-items-center text-sm text-red-600">Não foi possível carregar o modelo.</div>
      )}
      {estado === "pronto" && (
        <div className="absolute bottom-3 left-3 flex gap-2">
          <button
            onClick={() => setCotas((v) => !v)}
            className="rounded-full bg-white/90 px-3 py-1.5 text-xs font-medium shadow hover:bg-white"
          >
            {cotas ? "Ocultar medidas" : "Mostrar medidas"}
          </button>
          <button
            onClick={() => resetRef.current()}
            className="rounded-full bg-white/90 px-3 py-1.5 text-xs font-medium shadow hover:bg-white"
          >
            Centralizar
          </button>
        </div>
      )}
      {estado === "pronto" && (
        <p className="pointer-events-none absolute right-3 top-3 text-[11px] text-neutral-500">
          Arraste para girar · role para aproximar
        </p>
      )}
    </div>
  );
}
