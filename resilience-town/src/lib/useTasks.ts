"use client";

import { createClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Task } from "./types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const realtimeEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON);

const MAX_PARALLEL_RUNS = 4;
const REKICK_MS = 20_000;

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json as T;
}

/**
 * Live task list (Supabase Realtime, or polling in demo mode) plus a small
 * dispatcher that sends queued work to /api/run-task. The server claims tasks
 * atomically, so several open tabs never run the same task twice.
 */
export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Task ids present on first load; those wait for an explicit Run unless resumed. */
  const preexisting = useRef<Set<string> | null>(null);
  const kicked = useRef(new Map<string, number>());
  const inflight = useRef(0);

  const upsert = useCallback((t: Task) => {
    setTasks((cur) => {
      const i = cur.findIndex((x) => x.id === t.id);
      if (i === -1) return [t, ...cur];
      if (cur[i].updated_at > t.updated_at) return cur;
      const next = cur.slice();
      next[i] = t;
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const list = await api<Task[]>("/api/tasks");
      preexisting.current ??= new Set(list.map((t) => t.id));
      setTasks(list);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
    if (!realtimeEnabled) {
      const t = setInterval(refresh, 1500);
      return () => clearInterval(t);
    }
    const sb = createClient(SUPABASE_URL!, SUPABASE_ANON!);
    const channel = sb
      .channel("tasks-feed")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, (p) => {
        if (p.eventType === "DELETE") setTasks((cur) => cur.filter((t) => t.id !== (p.old as Task).id));
        else upsert(p.new as Task);
      })
      .subscribe();
    const safety = setInterval(refresh, 30_000);
    return () => {
      clearInterval(safety);
      sb.removeChannel(channel);
    };
  }, [refresh, upsert]);

  const run = useCallback(
    async (id: string) => {
      kicked.current.set(id, Date.now());
      inflight.current++;
      try {
        const r = await api<{ ran: boolean; task?: Task }>("/api/run-task", { taskId: id });
        if (r.task) {
          upsert(r.task);
          if (r.task.status === "queued") kicked.current.delete(id); // checkpointed: continue right away
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        inflight.current--;
      }
    },
    [upsert],
  );

  // Auto-dispatch queued work created or resumed in this session. Seeded /
  // older queued tasks wait for an explicit Run so nothing spends tokens on page load.
  useEffect(() => {
    if (!preexisting.current) return;
    const now = Date.now();
    for (const t of tasks) {
      if (t.status !== "queued") continue;
      const fresh = !preexisting.current.has(t.id);
      const resumed = (t.conversation?.length ?? 0) > 0 || t.steps.length > 0;
      if (!fresh && !resumed) continue;
      const last = kicked.current.get(t.id);
      if (last && now - last < REKICK_MS) continue;
      if (inflight.current >= MAX_PARALLEL_RUNS) break;
      void run(t.id);
    }
  }, [tasks, run]);

  const create = useCallback(
    async (input: { agent_id: string; title: string; instructions: string; priority: string; due_date?: string | null }) => {
      const t = await api<Task>("/api/tasks", input);
      upsert(t);
      return t;
    },
    [upsert],
  );

  const act = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      const t = await api<Task>(`/api/tasks/${id}`, body);
      upsert(t);
      return t;
    },
    [upsert],
  );

  return { tasks, error, create, act, run, refresh };
}
