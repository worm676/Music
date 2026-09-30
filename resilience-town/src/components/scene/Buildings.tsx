"use client";

import { Html } from "@react-three/drei";
import { useState } from "react";
import type { Building as B } from "@/config/agents";

const WALL = "#efe7da";
const ROOF = "#5b6475";
const WINDOW = "#9fd3ff";

function Box({ p, s, c, cast = true }: { p: [number, number, number]; s: [number, number, number]; c: string; cast?: boolean }) {
  return (
    <mesh position={p} castShadow={cast} receiveShadow>
      <boxGeometry args={s} />
      <meshStandardMaterial color={c} flatShading />
    </mesh>
  );
}

function Door({ z, accent }: { z: number; accent: string }) {
  return <Box p={[0, 0.8, z]} s={[1.1, 1.6, 0.12]} c={accent} />;
}

function Windows({ rows, cols, w, z, y0 }: { rows: number; cols: number; w: number; z: number; y0: number }) {
  const out = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = -w / 2 + (w / (cols + 1)) * (c + 1);
      out.push(<Box key={`${r}-${c}`} p={[x, y0 + r * 1.3, z]} s={[0.6, 0.7, 0.08]} c={WINDOW} cast={false} />);
    }
  return <>{out}</>;
}

function Shape({ style, accent }: { style: B["style"]; accent: string }) {
  switch (style) {
    case "hq":
      return (
        <group>
          <Box p={[0, 3.5, 0]} s={[4, 7, 4]} c={WALL} />
          <Windows rows={4} cols={3} w={4} z={2.01} y0={2.4} />
          <mesh position={[0, 8, 0]} castShadow>
            <coneGeometry args={[3, 2, 4]} />
            <meshStandardMaterial color={accent} flatShading />
          </mesh>
          <Box p={[0, 10, 0]} s={[0.1, 2.4, 0.1]} c="#444" />
          <Box p={[0.45, 10.8, 0]} s={[0.8, 0.5, 0.05]} c={accent} />
          <Door z={2.01} accent="#3b3f4a" />
        </group>
      );
    case "office":
      return (
        <group>
          <Box p={[0, 2.25, 0]} s={[5, 4.5, 3.5]} c={WALL} />
          <Windows rows={2} cols={4} w={5} z={1.76} y0={2.3} />
          <Box p={[0, 4.65, 0]} s={[5.3, 0.3, 3.8]} c={ROOF} />
          <Box p={[0, 5.3, 0]} s={[2.6, 0.9, 0.2]} c={accent} />
          <Door z={1.76} accent={accent} />
        </group>
      );
    case "studio":
      return (
        <group>
          <Box p={[0, 1.75, 0]} s={[5, 3.5, 4]} c={WALL} />
          <group position={[0, 3.5, 0]} rotation={[0, 0, 0.25]}>
            <Box p={[0, 0.3, 0]} s={[5.6, 0.3, 4.4]} c={accent} />
          </group>
          {[-1.5, 0, 1.5].map((x, i) => (
            <Box key={x} p={[x, 2.6, 2.01]} s={[1.1, 0.5, 0.08]} c={["#ff6b9a", "#ffd166", "#06d6a0"][i]} cast={false} />
          ))}
          <Door z={2.01} accent="#3b3f4a" />
        </group>
      );
    case "workshop":
      return (
        <group>
          <Box p={[0, 1.6, 0]} s={[6, 3.2, 4]} c="#d9c3a5" />
          <mesh position={[0, 3.2, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[2.3, 2.3, 6.2, 3]} />
            <meshStandardMaterial color={accent} flatShading />
          </mesh>
          <Box p={[2, 5, -0.8]} s={[0.7, 2, 0.7]} c="#7a4f3a" />
          <Box p={[0, 1.2, 2.01]} s={[2.2, 2.4, 0.1]} c="#6b5a4a" />
        </group>
      );
    case "vault":
      return (
        <group>
          <mesh position={[0, 1.5, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[3, 3.2, 3, 8]} />
            <meshStandardMaterial color="#b9c2cf" flatShading />
          </mesh>
          <mesh position={[0, 3, 0]} castShadow>
            <sphereGeometry args={[3, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color={accent} flatShading />
          </mesh>
          <mesh position={[0, 1.3, 2.95]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[1, 1, 0.3, 12]} />
            <meshStandardMaterial color="#6b7280" flatShading metalness={0.4} />
          </mesh>
        </group>
      );
    case "library":
      return (
        <group>
          <Box p={[0, 0.25, 0.4]} s={[6, 0.5, 4.8]} c="#d6d0c4" />
          <Box p={[0, 2.2, -0.4]} s={[5, 3.4, 3]} c={WALL} />
          {[-2.2, -1.1, 0, 1.1, 2.2].map((x) => (
            <mesh key={x} position={[x, 2, 1.9]} castShadow>
              <cylinderGeometry args={[0.22, 0.22, 3.1, 8]} />
              <meshStandardMaterial color="#f7f3ea" flatShading />
            </mesh>
          ))}
          <Box p={[0, 3.75, 0.4]} s={[5.8, 0.4, 4.4]} c="#e2dccf" />
          <mesh position={[0, 4.5, 0.4]} rotation={[0, Math.PI / 4, 0]} castShadow>
            <coneGeometry args={[4, 1.2, 4]} />
            <meshStandardMaterial color={accent} flatShading />
          </mesh>
          <Door z={1.11} accent="#3b3f4a" />
        </group>
      );
  }
}

export function Building({ b, accent, label, onClick }: { b: B; accent: string; label: string; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  const [x, z] = b.position;
  const faceCenter = Math.atan2(-x, -z);
  return (
    <group
      position={[x, 0, z]}
      rotation={[0, faceCenter, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHover(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHover(false);
        document.body.style.cursor = "";
      }}
      scale={hover ? 1.03 : 1}
    >
      <Box p={[0, 0.05, 0.6]} s={[7.5, 0.1, 6.8]} c="#cfd6c4" cast={false} />
      <Shape style={b.style} accent={accent} />
      <Html position={[0, 0.2, 3.9]} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div className="whitespace-nowrap rounded bg-slate-900/75 px-2 py-0.5 text-[11px] font-medium text-white">{label}</div>
      </Html>
    </group>
  );
}
