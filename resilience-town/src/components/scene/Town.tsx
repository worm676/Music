"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { AGENTS, BUILDINGS } from "@/config/agents";
import type { AgentStatus } from "@/lib/status";
import { AgentCharacter } from "./AgentCharacter";
import { Building } from "./Buildings";
import { agentPositions, PLAZA_RADIUS } from "./positions";

type Props = {
  statuses: Record<string, AgentStatus>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

export default function Town({ statuses, selectedId, onSelect }: Props) {
  return (
    <Canvas
      shadows
      orthographic
      dpr={[1, 2]}
      camera={{ position: [40, 38, 40], zoom: 18, near: -200, far: 500 }}
      onPointerMissed={() => onSelect(null)}
    >
      <color attach="background" args={["#bfe3f5"]} />
      <hemisphereLight args={["#ffffff", "#7aa36b", 0.9]} />
      <directionalLight
        position={[25, 40, 15]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-35}
        shadow-camera-right={35}
        shadow-camera-top={35}
        shadow-camera-bottom={-35}
      />
      <Ground />
      <Plaza />
      <Roads />
      <Trees />
      {BUILDINGS.map((b) => {
        const owner = AGENTS.find((a) => a.building === b.id);
        return (
          <Building
            key={b.id}
            b={b}
            accent={owner?.color ?? "#999"}
            label={owner ? `${b.name} · ${owner.name}` : b.name}
            onClick={() => owner && onSelect(owner.id)}
          />
        );
      })}
      {AGENTS.map((a) => (
        <AgentCharacter
          key={a.id}
          agent={a}
          status={statuses[a.id] ?? "idle"}
          selected={selectedId === a.id}
          onSelect={() => onSelect(a.id)}
        />
      ))}
      <CameraRig selectedId={selectedId} />
    </Canvas>
  );
}

/** Orbit/zoom controls that glide to and follow the selected agent. */
function CameraRig({ selectedId }: { selectedId: string | null }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();
  const transition = useRef(0);
  const origin = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    transition.current = 1.2;
  }, [selectedId]);

  useFrame((_, dt) => {
    const c = controls.current;
    if (!c) return;
    const goal = selectedId ? agentPositions.get(selectedId) : transition.current > 0 ? origin : null;
    if (!goal) return;
    const k = transition.current > 0 ? 0.08 : 0.25; // glide in, then follow
    const delta = goal.clone().sub(c.target).multiplyScalar(k);
    delta.y = 0;
    c.target.add(delta);
    camera.position.add(delta);
    if (transition.current > 0) {
      const cam = camera as THREE.OrthographicCamera;
      const want = selectedId ? 38 : 18;
      cam.zoom = THREE.MathUtils.lerp(cam.zoom, want, 0.08);
      cam.updateProjectionMatrix();
      transition.current -= dt;
    }
    c.update();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan
      minZoom={8}
      maxZoom={80}
      minPolarAngle={0.35}
      maxPolarAngle={1.2}
      target={[0, 0, 0]}
    />
  );
}

function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <circleGeometry args={[34, 48]} />
      <meshStandardMaterial color="#8cc084" flatShading />
    </mesh>
  );
}

function Plaza() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} receiveShadow>
        <circleGeometry args={[PLAZA_RADIUS, 6]} />
        <meshStandardMaterial color="#e2d9c6" flatShading />
      </mesh>
      {/* Fountain */}
      <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.6, 1.8, 0.6, 12]} />
        <meshStandardMaterial color="#c9cfd8" flatShading />
      </mesh>
      <mesh position={[0, 0.62, 0]}>
        <cylinderGeometry args={[1.4, 1.4, 0.05, 12]} />
        <meshStandardMaterial color="#5ec8f2" flatShading />
      </mesh>
      <mesh position={[0, 1.1, 0]} castShadow>
        <cylinderGeometry args={[0.2, 0.3, 1.2, 6]} />
        <meshStandardMaterial color="#c9cfd8" flatShading />
      </mesh>
      <mesh position={[0, 1.8, 0]}>
        <icosahedronGeometry args={[0.35, 0]} />
        <meshStandardMaterial color="#f5c542" flatShading emissive="#f5c542" emissiveIntensity={0.3} />
      </mesh>
    </group>
  );
}

function Roads() {
  return (
    <group>
      {BUILDINGS.map((b) => {
        const [x, z] = b.position;
        const len = Math.hypot(x, z) - PLAZA_RADIUS - 2;
        const mid = (PLAZA_RADIUS + len / 2) / Math.hypot(x, z);
        return (
          <mesh key={b.id} position={[x * mid, 0.02, z * mid]} rotation={[-Math.PI / 2, 0, -Math.atan2(z, x)]} receiveShadow>
            <planeGeometry args={[len, 1.8]} />
            <meshStandardMaterial color="#d8cfbd" />
          </mesh>
        );
      })}
    </group>
  );
}

function Trees() {
  // Deterministic scatter between and behind buildings.
  const trees = useMemo(() => {
    const out: { p: [number, number, number]; s: number }[] = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) {
      const ang = rnd() * Math.PI * 2;
      const r = 9 + rnd() * 23;
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r;
      const nearBuilding = BUILDINGS.some((b) => Math.hypot(b.position[0] - x, b.position[1] - z) < 5.5);
      const onRoad = BUILDINGS.some((b) => {
        const [bx, bz] = b.position;
        const L = Math.hypot(bx, bz);
        const t = (x * bx + z * bz) / (L * L);
        return t > 0 && t < 1 && Math.hypot(x - bx * t, z - bz * t) < 2;
      });
      if (!nearBuilding && !onRoad) out.push({ p: [x, 0, z], s: 0.7 + rnd() * 0.6 });
    }
    return out;
  }, []);
  return (
    <group>
      {trees.map((t, i) => (
        <group key={i} position={t.p} scale={t.s}>
          <mesh position={[0, 0.5, 0]} castShadow>
            <cylinderGeometry args={[0.15, 0.2, 1, 5]} />
            <meshStandardMaterial color="#7a5234" flatShading />
          </mesh>
          <mesh position={[0, 1.6, 0]} castShadow>
            <coneGeometry args={[0.9, 1.8, 6]} />
            <meshStandardMaterial color={i % 3 ? "#3f8f55" : "#4fa865"} flatShading />
          </mesh>
        </group>
      ))}
    </group>
  );
}
