import * as THREE from "three";
import { AGENTS, BUILDINGS } from "@/config/agents";

/** Live world positions of agents, written by AgentCharacter and read by the camera rig. */
export const agentPositions = new Map<string, THREE.Vector3>();

export const PLAZA_RADIUS = 6;

/** Where an agent stands when idle: on the plaza, facing its own building. */
export function homeSpot(agentId: string): THREE.Vector3 {
  const a = AGENTS.find((x) => x.id === agentId)!;
  const b = BUILDINGS.find((x) => x.id === a.building);
  const [bx, bz] = b ? b.position : [0, 0];
  const dir = new THREE.Vector3(bx, 0, bz).normalize();
  return dir.multiplyScalar(PLAZA_RADIUS - 1.6);
}

/** Where an agent stands while working: at its building's front door. */
export function workSpot(agentId: string): THREE.Vector3 {
  const a = AGENTS.find((x) => x.id === agentId)!;
  const b = BUILDINGS.find((x) => x.id === a.building);
  const [bx, bz] = b ? b.position : [0, 0];
  const v = new THREE.Vector3(bx, 0, bz);
  return v.sub(v.clone().normalize().multiplyScalar(4.2));
}
