import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { hasSupabase } from "./env";
import { SEED_TASKS } from "./seed";
import type { NewTask, Step, Task, TaskStatus } from "./types";

export type TaskPatch = Partial<Omit<Task, "id" | "created_at">>;

export interface TaskStore {
  list(): Promise<Task[]>;
  get(id: string): Promise<Task | null>;
  insert(t: NewTask): Promise<Task>;
  update(id: string, patch: TaskPatch): Promise<Task>;
  /** Atomically move a task from `from` to `to`. Returns null if another worker won. */
  claim(id: string, from: TaskStatus, to: TaskStatus): Promise<Task | null>;
  oldestQueued(): Promise<Task | null>;
}

const now = () => new Date().toISOString();

function draft(t: NewTask): Task {
  const ts = now();
  return {
    id: crypto.randomUUID(),
    agent_id: t.agent_id,
    title: t.title,
    instructions: t.instructions,
    priority: t.priority ?? "normal",
    due_date: t.due_date ?? null,
    status: "queued",
    result: null,
    steps: [],
    parent_task_id: t.parent_task_id ?? null,
    conversation: null,
    pending_action: null,
    approved_at: null,
    created_at: ts,
    updated_at: ts,
  };
}

/** In-memory store used when Supabase isn't configured, so the app runs out of the box. */
class MemoryStore implements TaskStore {
  private tasks = new Map<string, Task>();
  constructor() {
    // Seeds sit in the queue until the operator presses Run (they don't auto-dispatch).
    SEED_TASKS.forEach((s, i) => {
      const t = draft(s);
      t.created_at = t.updated_at = new Date(Date.now() - (SEED_TASKS.length - i) * 1000).toISOString();
      t.status = "queued";
      this.tasks.set(t.id, t);
    });
  }
  async list() {
    return [...this.tasks.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async get(id: string) {
    return this.tasks.get(id) ?? null;
  }
  async insert(n: NewTask) {
    const t = draft(n);
    this.tasks.set(t.id, t);
    return t;
  }
  async update(id: string, patch: TaskPatch) {
    const cur = this.tasks.get(id);
    if (!cur) throw new Error(`task ${id} not found`);
    const next = { ...cur, ...patch, updated_at: now() };
    this.tasks.set(id, next);
    return next;
  }
  async claim(id: string, from: TaskStatus, to: TaskStatus) {
    const cur = this.tasks.get(id);
    if (!cur || cur.status !== from) return null;
    return this.update(id, { status: to });
  }
  async oldestQueued() {
    const q = [...this.tasks.values()].filter((t) => t.status === "queued");
    return q.sort((a, b) => a.created_at.localeCompare(b.created_at))[0] ?? null;
  }
}

class SupabaseStore implements TaskStore {
  private db: SupabaseClient;
  constructor() {
    this.db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
  }
  private check<T>(res: { data: T | null; error: { message: string } | null }): T {
    if (res.error) throw new Error(res.error.message);
    return res.data as T;
  }
  async list() {
    return this.check(await this.db.from("tasks").select("*").order("created_at", { ascending: false }).limit(300)) as Task[];
  }
  async get(id: string) {
    return this.check(await this.db.from("tasks").select("*").eq("id", id).maybeSingle()) as Task | null;
  }
  async insert(n: NewTask) {
    const row = {
      agent_id: n.agent_id,
      title: n.title,
      instructions: n.instructions,
      priority: n.priority ?? "normal",
      due_date: n.due_date ?? null,
      parent_task_id: n.parent_task_id ?? null,
    };
    return this.check(await this.db.from("tasks").insert(row).select().single()) as Task;
  }
  async update(id: string, patch: TaskPatch) {
    return this.check(await this.db.from("tasks").update(patch).eq("id", id).select().single()) as Task;
  }
  async claim(id: string, from: TaskStatus, to: TaskStatus) {
    const rows = this.check(
      await this.db.from("tasks").update({ status: to }).eq("id", id).eq("status", from).select(),
    ) as Task[];
    return rows[0] ?? null;
  }
  async oldestQueued() {
    const rows = this.check(
      await this.db.from("tasks").select("*").eq("status", "queued").order("created_at").limit(1),
    ) as Task[];
    return rows[0] ?? null;
  }
}

const g = globalThis as unknown as { __rtStore?: TaskStore };
export function store(): TaskStore {
  if (!g.__rtStore) g.__rtStore = hasSupabase() ? new SupabaseStore() : new MemoryStore();
  return g.__rtStore;
}

export async function addSteps(id: string, steps: Step[], patch: TaskPatch = {}) {
  const s = store();
  const cur = await s.get(id);
  if (!cur) throw new Error(`task ${id} not found`);
  return s.update(id, { ...patch, steps: [...(cur.steps ?? []), ...steps] });
}

export const step = (kind: Step["kind"], text: string, data?: unknown): Step => ({ at: now(), kind, text, data });
