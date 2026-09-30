import type { NewTask } from "./types";

/** One demo task per agent. Mirrored in supabase/migrations/0001_init.sql. */
export const SEED_TASKS: NewTask[] = [
  {
    agent_id: "chief",
    title: "Plan Q4 growth push",
    instructions:
      "Goal: land 5 new infrastructure clients this quarter. Break this into subtasks for the team (research, outreach, marketing, delivery readiness, CRM hygiene).",
    priority: "high",
  },
  {
    agent_id: "scout",
    title: "Competitor scan: business infrastructure agencies",
    instructions:
      "Find 5 competitors offering done-for-you sales + delivery infrastructure to small businesses. Compare offers, pricing signals and positioning. Recommend how we differentiate.",
    priority: "normal",
  },
  {
    agent_id: "closer",
    title: "Cold outreach sequence for local service businesses",
    instructions:
      "Draft a 3-email cold sequence for owners of local service businesses (HVAC, roofing, cleaning) doing $500k-$3M/yr. Offer a free systems audit. Drafts only, do not send.",
    priority: "normal",
  },
  {
    agent_id: "spark",
    title: "LinkedIn content plan (2 weeks)",
    instructions:
      "Create a 2-week LinkedIn posting plan for Jhonathon: 6 posts about scaling a business with better systems. Include hooks and full post copy.",
    priority: "normal",
  },
  {
    agent_id: "builder",
    title: "New client onboarding checklist",
    instructions:
      "Write the onboarding checklist for a new client from signed contract to kickoff call to first deliverable in 14 days.",
    priority: "normal",
  },
  {
    agent_id: "keeper",
    title: "Log demo lead in CRM",
    instructions:
      "Upsert a contact: Dana Reyes, dana@example.com, Reyes Roofing, stage 'Discovery call booked', note 'Interested in sales pipeline setup'.",
    priority: "low",
  },
];
