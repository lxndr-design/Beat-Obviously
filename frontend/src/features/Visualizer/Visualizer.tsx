import { Canvas, useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { useTransportStore } from "../../state/store";
import styles from "./Visualizer.module.css";

/**
 * Visualizer — low-priority background. Three.js / React Three Fiber.
 *
 * Renders behind the UI as a fixed canvas. The transport's `positionBeat`
 * drives time. Currently a single shader-driven plane that pulses with
 * playback — extend by registering new VisualizerVariants behind the
 * `Visualizer` interface (lives in features/Visualizer/variants/).
 *
 * Architecture note: the openFrameworks-backed variant (if ever added)
 * would plug in here as another VisualizerVariant rendering into a
 * fullscreen WebGL texture streamed from the native process.
 */
export function Visualizer() {
  return (
    <div className={styles.host} aria-hidden>
      <Canvas
        gl={{ antialias: false, alpha: false, powerPreference: "low-power" }}
        camera={{ position: [0, 0, 2], fov: 60 }}
        dpr={[1, 1]} // limit DPR — keep it as background, not centerpiece
      >
        <PulsePlane />
      </Canvas>
    </div>
  );
}

function PulsePlane() {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.ShaderMaterial>(null);

  useFrame(({ clock }) => {
    const pos = useTransportStore.getState().positionBeat;
    if (matRef.current) {
      matRef.current.uniforms.uTime.value = clock.elapsedTime;
      matRef.current.uniforms.uBeat.value = pos;
    }
  });

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[4, 4]} />
      <shaderMaterial
        ref={matRef}
        uniforms={{
          uTime: { value: 0 },
          uBeat: { value: 0 },
        }}
        vertexShader={`
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          precision highp float;
          uniform float uTime;
          uniform float uBeat;
          varying vec2 vUv;

          // Pseudo-random / dither — keeps things B&W per design rule
          float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
          }

          void main() {
            // Concentric pulse driven by beat position
            vec2 p = vUv - 0.5;
            float r = length(p);
            float pulse = sin(uBeat * 1.5707963 - r * 12.0) * 0.5 + 0.5;
            // Ordered dither for B&W threshold
            float n = hash(floor(vUv * 256.0));
            float v = step(n, pulse * 0.6 + 0.05);
            gl_FragColor = vec4(vec3(v), 1.0);
          }
        `}
      />
    </mesh>
  );
}
