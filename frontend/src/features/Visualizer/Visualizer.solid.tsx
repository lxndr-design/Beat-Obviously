import { onCleanup, onMount } from "solid-js";
import * as THREE from "three";
import { useTransportStore } from "../../state/store";
import styles from "./Visualizer.module.css";

/**
 * Visualizer — low-priority raw Three background.
 *
 * This owns a tiny Three lifecycle directly and keeps DPR at 1
 * so it remains a subtle background layer rather than a rendering hotspot.
 */
export function Visualizer() {
  let hostElement: HTMLDivElement | undefined;

  onMount(() => {
    if (!hostElement) return;

    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: "low-power",
    });
    renderer.setPixelRatio(1);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10);
    camera.position.set(0, 0, 2);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBeat: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform float uTime;
        uniform float uBeat;
        varying vec2 vUv;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        void main() {
          vec2 p = vUv - 0.5;
          float r = length(p);
          float pulse = sin(uBeat * 1.5707963 - r * 12.0) * 0.5 + 0.5;
          float n = hash(floor(vUv * 256.0));
          float v = step(n, pulse * 0.6 + 0.05);
          gl_FragColor = vec4(vec3(v), 1.0);
        }
      `,
    });
    const geometry = new THREE.PlaneGeometry(4, 4);
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    hostElement.appendChild(renderer.domElement);

    const resize = () => {
      if (!hostElement) return;
      const width = Math.max(1, hostElement.clientWidth || window.innerWidth);
      const height = Math.max(1, hostElement.clientHeight || window.innerHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    const clock = new THREE.Clock();
    let frameId = 0;
    const animate = () => {
      material.uniforms.uTime.value = clock.elapsedTime;
      material.uniforms.uBeat.value = useTransportStore.getState().positionBeat;
      renderer.render(scene, camera);
      frameId = window.requestAnimationFrame(animate);
    };

    resize();
    window.addEventListener("resize", resize);
    frameId = window.requestAnimationFrame(animate);

    onCleanup(() => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", resize);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    });
  });

  return <div ref={hostElement} class={styles.host} aria-hidden="true" />;
}
