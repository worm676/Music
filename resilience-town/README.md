# Resilience Town

A 3D command center for Resilience Enterprise's AI agents. You assign work in a low-poly town, and the agent walks to its building, does the work with Claude, and walks back to the plaza when it's done.

- **3D town** (React Three Fiber): isometric camera you can orbit and zoom. There is one building per agent, and each character has a status ring: grey idle, blue working, green done (waiting for your review), amber needs you, red error. Click an agent or building and the camera moves to it and opens its panel.
- **Agents** (`src/config/agents.ts`):
  - Chief orchestrates the others.
  - Scout does research.
  - Closer handles sales.
  - Spark handles marketing.
  - Builder handles delivery.
  - Keeper handles the CRM.

  Each agent has a name, role, system prompt, color, building and allowed tools.
- **Tasks** live in Supabase (Postgres + Realtime), so the scene and panels update live.
- **Tools**:
  - `web_search`: Anthropic server tool.
  - `call_webhook`: POSTs to `N8N_WEBHOOK_*`. Runs only after you approve it.
  - `ask_user`: pauses the task until you reply.
  - `create_subtask`: Chief only.
- **Approval gate**: anything that sends an external message or writes to the CRM goes through `call_webhook`. Nothing is sent until you click **Approve & send** and see the payload.

## Run it locally (no keys needed)

```bash
cd resilience-town
npm install
npm run dev          # http://localhost:3000
```

With no env vars the app runs in **demo mode**:
- Tasks are kept in server memory.
- Agents give simulated output.
- The walking, statuses, Chief's subtasks and the Keeper approval gate all still work.

Add keys to `.env.local` to go live:

```bash
cp .env.example .env.local
```

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Real agent work with Claude (`claude-opus-5-5`). Without it you get demo mode. |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Persistent tasks and Realtime. Without them, tasks are kept in memory. |
| `N8N_WEBHOOK_CRM`, `N8N_WEBHOOK_EMAIL` | Webhook URLs for Keeper (CRM) and Closer (email). Any `N8N_WEBHOOK_<NAME>` becomes a webhook the agents can call as `<name>`. |
| `APP_PASSWORD` | Optional. Puts the whole app behind a password (HTTP Basic auth, any username). **Set this before deploying.** |

## Supabase setup

1. Create a project at supabase.com.
2. Open **SQL Editor**, paste in `supabase/migrations/0001_init.sql`, and run it. This does four things:
   - creates the `tasks` table and its `updated_at` trigger;
   - turns on RLS (the browser can only read; all writes go through the server with the service role key);
   - adds the table to the `supabase_realtime` publication;
   - seeds one demo task per agent.
3. Copy the Project URL, the anon key and the service role key from **Settings → API** into your env.

Seeded tasks wait in the queue until you press **Run now** (on the task) or **Run N queued** (in the feed), so opening the app never spends tokens by itself. Tasks you assign, Chief's subtasks, and tasks resumed after you answer or approve start automatically.

## Using it

- **Assign work**: click an agent → fill in title, instructions, priority and an optional due date → **Assign**.
- **Big goals**: type into **Command** in the top bar. Chief breaks the goal into subtasks for the other agents. They show up nested under Chief's task in the feed and start right away.
- **Task feed** (top right): every task across all agents, with filters. Expand a task to see:
  - the live step log (thinking summaries, searches, tool calls);
  - the Markdown result;
  - **Approve / Revise / Retry**.
- **Needs you (amber)**: the agent either asked a question (reply in the box) or wants to call a webhook (check the JSON, then **Approve & send** or **Decline**).

## How the agent run works

`POST /api/run-task` with `{ taskId }` claims a queued task atomically, so two tabs or workers can't run the same task twice. Without a body it picks the oldest queued task, which lets a cron job or an n8n schedule drive the queue.

The runner (`src/lib/runner.ts`) is a manual Claude tool-use loop:
- It uses adaptive thinking with summarized thoughts shown in the log, `effort: medium`, and server-side refusal fallback (`fallbacks: "default"`).
- After each turn it saves the full conversation to `tasks.conversation` and the step log to `tasks.steps`.
- `ask_user` and `call_webhook` stop the loop with `status = needs_input` and record what's pending in `tasks.pending_action`. Your reply or approval becomes the tool result and the task is queued again. It picks up exactly where it stopped.
- Long runs save a checkpoint before the serverless time limit and continue in a new call.

## Add an agent

1. Add a building to `BUILDINGS` in `src/config/agents.ts` (pick a `style`, or add a new one in `src/components/scene/Buildings.tsx`).
2. Add an entry to `AGENTS` with `id`, `name`, `role`, `color`, `building`, `tools` and `systemPrompt`.
3. If Chief should delegate to it, mention it in Chief's system prompt. The `create_subtask` tool picks up new agents automatically.

## Deploy to Vercel

1. Push the repo to GitHub and import it in Vercel.
2. Set **Root Directory** to `resilience-town` (framework: Next.js is detected automatically).
3. Add the env vars from the table above, including `APP_PASSWORD`.
4. Deploy. `/api/run-task` declares `maxDuration = 300`. On the Hobby plan Vercel caps functions at 60s. The runner checkpoints and resumes, so long tasks still finish, just across more calls. Pro gives each call more room.

**Security note:** the API routes can run agents and send webhooks. Use `APP_PASSWORD`, or add real auth, on any public deployment. With Supabase, anyone who has the anon key can read the `tasks` table (the RLS policy allows reads). Tighten that policy if you add user accounts.

## Project layout

```
src/config/agents.ts          agent + building roster
src/lib/runner.ts             Claude agent loop
src/lib/tools.ts              tool definitions + webhook POST
src/lib/actions.ts            answer / approve / decline / revise / retry
src/lib/store.ts              Supabase store (or in-memory fallback)
src/lib/mock-runner.ts        demo mode
src/lib/useTasks.ts           realtime feed + dispatcher (client)
src/components/scene/*        3D town, buildings, characters, camera
src/components/ui/*           top bar, agent panel, task feed
supabase/migrations/          SQL schema + seed
```
