"use client";

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { AgentConfig } from "@/config/agents";
import { STATUS_COLOR, STATUS_LABEL, type AgentStatus } from "@/lib/status";
import { agentPositions, homeSpot, workSpot } from "./positions";

const SPEED = 3.2;
const SKIN = "#f1c7a0";

export function AgentCharacter({
  agent,
  status,
  selected,
  onSelect,
}: {
  agent: AgentConfig;
  status: AgentStatus;
  selected: boolean;
  onSelect: () => void;
}) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Mesh>(null);
  const legR = useRef<THREE.Mesh>(null);
  const armL = useRef<THREE.Mesh>(null);
  const armR = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const ringMat = useRef<THREE.MeshBasicMaterial>(null);

  const home = useMemo(() => homeSpot(agent.id), [agent.id]);
  const work = useMemo(() => workSpot(agent.id), [agent.id]);
  const atWork = status === "working" || status === "needs_input";
  const color = STATUS_COLOR[status];

  useFrame((state, dt) => {
    const g = root.current;
    if (!g) return;
    if (!agentPositions.has(agent.id)) {
      g.position.copy(home);
      agentPositions.set(agent.id, g.position);
    }
    const target = atWork ? work : home;
    const to = target.clone().sub(g.position);
    to.y = 0;
    const dist = to.length();
    const moving = dist > 0.05;
    const t = state.clock.elapsedTime;

    if (moving) {
      const step = Math.min(dist, SPEED * Math.min(dt, 0.05));
      g.position.add(to.normalize().multiplyScalar(step));
      const yaw = Math.atan2(to.x, to.z);
      g.rotation.y = lerpAngle(g.rotation.y, yaw, 0.2);
    } else {
      // Face the building while working, the plaza centre while idle.
      const face = atWork ? work.clone().multiplyScalar(2).sub(g.position) : g.position.clone().negate();
      g.rotation.y = lerpAngle(g.rotation.y, Math.atan2(face.x, face.z), 0.08);
    }

    const swing = moving ? Math.sin(t * 10) * 0.6 : status === "working" ? Math.sin(t * 14) * 0.25 : 0;
    if (legL.current) legL.current.rotation.x = moving ? swing : 0;
    if (legR.current) legR.current.rotation.x = moving ? -swing : 0;
    if (armL.current) armL.current.rotation.x = -swing;
    if (armR.current) armR.current.rotation.x = moving ? swing : -Math.abs(swing);
    if (body.current) body.current.position.y = moving ? Math.abs(Math.sin(t * 10)) * 0.08 : status === "done" ? Math.abs(Math.sin(t * 3)) * 0.15 : 0;

    const pulse = status === "working" || status === "needs_input" || status === "error";
    if (ring.current) ring.current.scale.setScalar(pulse ? 1 + Math.sin(t * 4) * 0.08 : 1);
    if (ringMat.current) ringMat.current.opacity = pulse ? 0.65 + Math.sin(t * 4) * 0.3 : 0.9;
  });

  return (
    <group
      ref={root}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => (document.body.style.cursor = "")}
    >
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
        <ringGeometry args={[0.7, selected ? 1.05 : 0.9, 32]} />
        <meshBasicMaterial ref={ringMat} color={color} transparent />
      </mesh>
      {/* Invisible, larger hit target so small characters are easy to click. */}
      <mesh position={[0, 1, 0]} visible={false}>
        <cylinderGeometry args={[0.9, 0.9, 2.4, 8]} />
        <meshBasicMaterial />
      </mesh>
      <group ref={body}>
        <mesh ref={legL} position={[-0.17, 0.55, 0]} castShadow geometry={legGeo}>
          <meshStandardMaterial color="#374151" flatShading />
        </mesh>
        <mesh ref={legR} position={[0.17, 0.55, 0]} castShadow geometry={legGeo}>
          <meshStandardMaterial color="#374151" flatShading />
        </mesh>
        <mesh position={[0, 1.05, 0]} castShadow>
          <cylinderGeometry args={[0.3, 0.38, 0.8, 7]} />
          <meshStandardMaterial color={agent.color} flatShading />
        </mesh>
        <mesh ref={armL} position={[-0.45, 1.35, 0]} castShadow geometry={armGeo}>
          <meshStandardMaterial color={agent.color} flatShading />
        </mesh>
        <mesh ref={armR} position={[0.45, 1.35, 0]} castShadow geometry={armGeo}>
          <meshStandardMaterial color={agent.color} flatShading />
        </mesh>
        <mesh position={[0, 1.78, 0]} castShadow>
          <icosahedronGeometry args={[0.32, 0]} />
          <meshStandardMaterial color={SKIN} flatShading />
        </mesh>
        <mesh position={[0, 2.02, 0]} castShadow>
          <coneGeometry args={[0.3, 0.3, 6]} />
          <meshStandardMaterial color={agent.color} flatShading />
        </mesh>
      </group>
      <Html position={[0, 2.7, 0]} center zIndexRange={[20, 10]} style={{ pointerEvents: "none" }}>
        <div className="flex flex-col items-center gap-0.5 whitespace-nowrap">
          <div
            className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white shadow"
            style={{ background: selected ? agent.color : "rgba(15,23,42,.85)", outline: `2px solid ${color}` }}
          >
            {agent.name}
          </div>
          {status !== "idle" && (
            <div className="rounded px-1.5 text-[10px] font-medium text-white" style={{ background: color }}>
              {STATUS_LABEL[status]}
            </div>
          )}
        </div>
      </Html>
    </group>
  );
}

// Limbs pivot at the top (hip / shoulder) so rotation swings them naturally.
const legGeo = new THREE.BoxGeometry(0.2, 0.6, 0.22).translate(0, -0.25, 0);
const armGeo = new THREE.BoxGeometry(0.16, 0.55, 0.16).translate(0, -0.22, 0);

function lerpAngle(a: number, b: number, t: number) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}
