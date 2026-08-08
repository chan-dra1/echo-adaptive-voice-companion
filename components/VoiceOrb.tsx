/**
 * VoiceOrb — Three.js Matrix core
 *
 * Calm / standby: 3D Matrix rain wrapping a dim wireframe nucleus.
 * Listening / speaking: audio-reactive icosahedron, fresnel core,
 * spinning rings, and additive particle bloom.
 */
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface Props {
  isActive: boolean;
  outputVolume: number;
  inputVolume: number;
  isThinking?: boolean;
}

const MATRIX_CHARS =
  'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン01ECHOΣΩΔλμπ$#@*&<>[]{}';

const CORE_VERT = /* glsl */ `
uniform float uTime;
uniform float uVolume;
varying vec3 vNormal;
varying vec3 vView;

void main() {
  float n = sin(position.x * 5.2 + uTime * 1.8)
          * cos(position.y * 4.4 - uTime * 1.4)
          * sin(position.z * 3.6 + uTime * 1.1);
  vec3 p = position + normal * n * (0.03 + uVolume * 0.42);
  vNormal = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const CORE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uVolume;
uniform float uEnergy;
varying vec3 vNormal;
varying vec3 vView;

void main() {
  float fresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.4);
  vec3 col = uColor * (0.18 + fresnel * 1.55 + uVolume * 0.9);
  col += vec3(0.55, 1.0, 0.7) * fresnel * uEnergy * 0.35;
  float alpha = 0.22 + fresnel * 0.62 + uVolume * 0.28;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.95));
}
`;

const RAIN_VERT = /* glsl */ `
attribute float aSeed;
attribute float aSpeed;
uniform float uTime;
uniform float uCalm;
uniform float uVolume;
varying float vAlpha;
varying float vGlyph;

void main() {
  float fall = fract(aSeed + uTime * aSpeed * mix(0.42, 0.14, uCalm));
  float py = (0.5 - fall) * 12.0;
  float drift = sin(uTime * 0.12 + aSeed * 6.283) * 0.16 * uCalm;
  vec3 p = vec3(position.x + drift, py, position.z);

  vGlyph = floor(fract(aSeed * 19.7 + uTime * aSpeed * 3.4) * 64.0);
  float head = 1.0 - fall;
  vAlpha = mix(0.06, 1.0, head * head) * mix(0.18, 0.92, uCalm);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = clamp((11.0 + uCalm * 8.0) * (3.8 / max(0.45, -mv.z)), 1.5, 22.0);
  gl_Position = projectionMatrix * mv;
}
`;

const RAIN_FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec3 uColor;
varying float vAlpha;
varying float vGlyph;

void main() {
  float col = mod(vGlyph, 8.0);
  float row = floor(vGlyph / 8.0);
  vec2 uv = (vec2(col, row) + gl_PointCoord) / 8.0;
  uv.y = 1.0 - uv.y;
  vec4 g = texture2D(uAtlas, uv);
  if (g.a < 0.12) discard;
  vec3 colr = mix(uColor * 0.35, vec3(0.75, 1.0, 0.82), g.r);
  gl_FragColor = vec4(colr, g.a * vAlpha);
}
`;

const SPARK_VERT = /* glsl */ `
attribute float aSeed;
uniform float uTime;
uniform float uVolume;
uniform float uInward;
varying float vAlpha;

void main() {
  float pulse = 0.22 + uVolume * 0.9 + sin(uTime * 3.2 + aSeed * 12.0) * 0.04;
  float dir = mix(1.0, -0.35, uInward);
  vec3 p = normalize(position) * pulse * dir;
  vAlpha = 0.12 + uVolume * 0.85;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = clamp((3.0 + uVolume * 14.0) * (2.0 / max(0.35, -mv.z)), 1.0, 18.0);
  gl_Position = projectionMatrix * mv;
}
`;

const SPARK_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;

void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float glow = pow(1.0 - d * 2.0, 2.0);
  gl_FragColor = vec4(uColor, vAlpha * glow);
}
`;

function makeGlyphAtlas(): THREE.CanvasTexture {
  const cols = 8;
  const cell = 64;
  const canvas = document.createElement('canvas');
  canvas.width = cols * cell;
  canvas.height = cols * cell;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${Math.floor(cell * 0.62)}px ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 64; i++) {
    const ch = MATRIX_CHARS[i % MATRIX_CHARS.length];
    const x = (i % cols) * cell + cell / 2;
    const y = Math.floor(i / cols) * cell + cell / 2;
    ctx.fillText(ch, x, y);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const VoiceOrb: React.FC<Props> = ({ isActive, outputVolume, inputVolume, isThinking = false }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef({ isActive, outputVolume, inputVolume, isThinking });
  const smoothOut = useRef(0);
  const smoothIn = useRef(0);
  const calmRef = useRef(1);

  useEffect(() => {
    propsRef.current = { isActive, outputVolume, inputVolume, isThinking };
  });

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);
    Object.assign(renderer.domElement.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      display: 'block',
      pointerEvents: 'none',
    });

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x010502, 0.045);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
    camera.position.set(0, 0.08, 4.15);

    const clock = new THREE.Clock();

    const setSize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    setSize();
    const ro = new ResizeObserver(setSize);
    ro.observe(mount);

    // ── Core (audio-reactive fresnel icosahedron) ───────────────
    const coreGeom = new THREE.IcosahedronGeometry(0.28, 4);
    const coreMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uVolume: { value: 0 },
        uEnergy: { value: 0 },
        uColor: { value: new THREE.Color('#00ff41') },
      },
      vertexShader: CORE_VERT,
      fragmentShader: CORE_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const core = new THREE.Mesh(coreGeom, coreMat);
    scene.add(core);

    const wireGeom = new THREE.IcosahedronGeometry(0.30, 1);
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x00ff41,
      wireframe: true,
      transparent: true,
      opacity: 0.35,
    });
    const wire = new THREE.Mesh(wireGeom, wireMat);
    scene.add(wire);

    // ── Orbit rings ─────────────────────────────────────────────
    const ringMats: THREE.MeshBasicMaterial[] = [];
    const rings: THREE.Mesh[] = [];
    const ringSpecs = [
      { r: 0.46, t: 0.008, rot: [0.9, 0.2, 0.1] as const, speed: [0.18, 0.07, 0.04] },
      { r: 0.58, t: 0.006, rot: [1.4, 0.6, 0.3] as const, speed: [-0.12, 0.15, 0.06] },
      { r: 0.72, t: 0.004, rot: [0.3, 1.2, 0.8] as const, speed: [0.08, -0.2, 0.11] },
    ];
    for (const spec of ringSpecs) {
      const g = new THREE.TorusGeometry(spec.r, spec.t, 8, 160);
      const m = new THREE.MeshBasicMaterial({
        color: 0x00ff41,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(g, m);
      mesh.rotation.set(spec.rot[0], spec.rot[1], spec.rot[2]);
      (mesh.userData as { speed: readonly number[] }).speed = spec.speed;
      ringMats.push(m);
      rings.push(mesh);
      scene.add(mesh);
    }

    // ── Matrix rain ─────────────────────────────────────────────
    const atlas = makeGlyphAtlas();
    const COLS = 96;
    const PER_COL = 24;
    const rainCount = COLS * PER_COL;
    const rainPos = new Float32Array(rainCount * 3);
    const rainSeed = new Float32Array(rainCount);
    const rainSpeed = new Float32Array(rainCount);
    for (let c = 0; c < COLS; c++) {
      const x = (Math.random() * 2 - 1) * 8.5;
      const z = -6.2 + Math.random() * 8.4;
      for (let r = 0; r < PER_COL; r++) {
        const i = c * PER_COL + r;
        rainPos[i * 3] = x + (Math.random() - 0.5) * 0.22;
        rainPos[i * 3 + 1] = 0;
        rainPos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.22;
        rainSeed[i] = Math.random();
        rainSpeed[i] = 0.16 + Math.random() * 0.6;
      }
    }
    const rainGeom = new THREE.BufferGeometry();
    rainGeom.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
    rainGeom.setAttribute('aSeed', new THREE.BufferAttribute(rainSeed, 1));
    rainGeom.setAttribute('aSpeed', new THREE.BufferAttribute(rainSpeed, 1));
    const rainMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uCalm: { value: 1 },
        uVolume: { value: 0 },
        uAtlas: { value: atlas },
        uColor: { value: new THREE.Color('#00ff41') },
      },
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const rain = new THREE.Points(rainGeom, rainMat);
    scene.add(rain);

    // ── Audio spark field ───────────────────────────────────────
    const SPARKS = 700;
    const sparkPos = new Float32Array(SPARKS * 3);
    const sparkSeed = new Float32Array(SPARKS);
    for (let i = 0; i < SPARKS; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      sparkPos[i * 3] = Math.sin(phi) * Math.cos(theta);
      sparkPos[i * 3 + 1] = Math.sin(phi) * Math.sin(theta);
      sparkPos[i * 3 + 2] = Math.cos(phi);
      sparkSeed[i] = Math.random();
    }
    const sparkGeom = new THREE.BufferGeometry();
    sparkGeom.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
    sparkGeom.setAttribute('aSeed', new THREE.BufferAttribute(sparkSeed, 1));
    const sparkMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uVolume: { value: 0 },
        uInward: { value: 0 },
        uColor: { value: new THREE.Color('#57ffb0') },
      },
      vertexShader: SPARK_VERT,
      fragmentShader: SPARK_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const sparks = new THREE.Points(sparkGeom, sparkMat);
    scene.add(sparks);

    let raf = 0;
    const color = new THREE.Color();

    const tick = () => {
      const { isActive, outputVolume, inputVolume, isThinking } = propsRef.current;
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;

      smoothOut.current += (outputVolume - smoothOut.current) * 0.1;
      smoothIn.current += (inputVolume - smoothIn.current) * 0.14;

      const outV = Math.min(1, smoothOut.current / 100);
      const inV = Math.min(1, smoothIn.current / 100);
      const vol = Math.max(outV, inV);
      const echoSpeaking = isActive && outV > 0.05 && outV >= inV;
      const userSpeaking = isActive && inV > 0.05 && inV > outV;
      const loud = echoSpeaking || userSpeaking;

      const targetCalm = !isActive ? 0.92 : loud ? 0.08 : isThinking ? 0.35 : 0.78;
      calmRef.current += (targetCalm - calmRef.current) * 0.06;
      const calm = calmRef.current;

      if (!isActive) color.setRGB(0.05, 0.45, 0.12);
      else if (isThinking) color.setRGB(0.17, 0.85, 0.42);
      else if (userSpeaking) color.setRGB(0.34, 1.0, 0.69);
      else color.setRGB(0.0, 1.0, 0.25);

      coreMat.uniforms.uTime.value = t;
      coreMat.uniforms.uVolume.value = vol;
      coreMat.uniforms.uEnergy.value = isActive ? (loud ? 1 : 0.35) : 0.08;
      (coreMat.uniforms.uColor.value as THREE.Color).copy(color);

      rainMat.uniforms.uTime.value = t;
      rainMat.uniforms.uCalm.value = calm;
      rainMat.uniforms.uVolume.value = vol;
      (rainMat.uniforms.uColor.value as THREE.Color).copy(color);

      sparkMat.uniforms.uTime.value = t;
      sparkMat.uniforms.uVolume.value = isActive ? vol : vol * 0.15;
      sparkMat.uniforms.uInward.value = userSpeaking ? 1 : 0;
      (sparkMat.uniforms.uColor.value as THREE.Color).copy(color);

      wireMat.color.copy(color);
      wireMat.opacity = isActive ? 0.22 + vol * 0.45 : 0.12;
      wire.rotation.y += dt * (0.12 + vol * 1.4);
      wire.rotation.x += dt * (0.05 + vol * 0.4);
      core.rotation.y = wire.rotation.y * 0.65;
      core.rotation.z = Math.sin(t * 0.35) * 0.08;
      const coreScale = 0.92 + vol * 0.35 + (isThinking ? Math.sin(t * 8) * 0.04 : 0);
      core.scale.setScalar(coreScale);
      wire.scale.setScalar(coreScale * 1.02);

      for (const ring of rings) {
        const sp = (ring.userData as { speed: number[] }).speed;
        const mul = isActive ? 1 + vol * 6 : 0.35;
        ring.rotation.x += dt * sp[0] * mul;
        ring.rotation.y += dt * sp[1] * mul;
        ring.rotation.z += dt * sp[2] * mul;
      }
      for (const m of ringMats) {
        m.color.copy(color);
        m.opacity = (isActive ? 0.18 : 0.08) + vol * 0.45;
      }

      rain.visible = calm > 0.06;
      sparks.visible = isActive && vol > 0.02;

      camera.position.x = Math.sin(t * 0.12) * 0.18;
      camera.position.y = 0.08 + Math.cos(t * 0.09) * 0.1;
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      rainGeom.dispose();
      sparkGeom.dispose();
      coreGeom.dispose();
      wireGeom.dispose();
      coreMat.dispose();
      wireMat.dispose();
      rainMat.dispose();
      sparkMat.dispose();
      atlas.dispose();
      for (const ring of rings) {
        ring.geometry.dispose();
      }
      for (const m of ringMats) m.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  const echoSpeaking = outputVolume > 8;
  const userSpeaking = inputVolume > 8;

  let stateLabel: string;
  let labelColor: string;
  let labelGlow: string;
  if (!isActive) {
    stateLabel = '·  S T A N D B Y  ·';
    labelColor = 'rgba(0,255,65,0.28)';
    labelGlow = 'none';
  } else if (isThinking) {
    stateLabel = '◌  P R O C E S S I N G  ◌';
    labelColor = '#2bd96b';
    labelGlow = '0 0 10px rgba(43,217,107,0.9), 0 0 28px rgba(43,217,107,0.4)';
  } else if (echoSpeaking) {
    stateLabel = '◈  S P E A K I N G  ◈';
    labelColor = '#00ff41';
    labelGlow = '0 0 10px rgba(0,255,65,0.9), 0 0 28px rgba(0,255,65,0.4)';
  } else if (userSpeaking) {
    stateLabel = '◉  L I S T E N I N G  ◉';
    labelColor = '#57ffb0';
    labelGlow = '0 0 10px rgba(87,255,176,0.9), 0 0 28px rgba(87,255,176,0.4)';
  } else {
    stateLabel = '·  R E A D Y  ·';
    labelColor = 'rgba(0,255,65,0.45)';
    labelGlow = '0 0 8px rgba(0,255,65,0.25)';
  }

  return (
    <div className="relative w-full h-full pointer-events-none">
      <div ref={mountRef} className="absolute inset-0 w-full h-full pointer-events-none" />
      <div
        className="absolute left-0 right-0 flex justify-center pointer-events-none z-10"
        style={{ top: '50%', transform: 'translateY(78px)' }}
      >
        <span
          className="font-mono uppercase select-none transition-all duration-700"
          style={{
            fontSize: 'clamp(7px, 1.3vw, 10px)',
            letterSpacing: '0.35em',
            color: labelColor,
            textShadow: labelGlow,
          }}
        >
          {stateLabel}
        </span>
      </div>
    </div>
  );
};

export default VoiceOrb;
