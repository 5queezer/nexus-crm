import type { ApplicationEventType } from "@/lib/applications/events";
import type { ApplicationStatus } from "@/types";

export const DEMO_FIXTURE_VERSION = 1;

export interface DemoApplicationFixture {
  demoKey: string;
  company: string;
  role: string;
  status: ApplicationStatus;
  appliedAt: Date | null;
  lastContact: Date | null;
  followUpAt: Date | null;
  notes: string;
  source: string;
  remote: boolean;
  salaryMin: number | null;
  salaryMax: number | null;
  rating: number | null;
}

export interface DemoEventFixture {
  demoKey: string;
  applicationDemoKey: string;
  type: ApplicationEventType;
  occurredAt: Date;
  source: string;
  actor: string;
  metadata: Record<string, unknown>;
}

export interface DemoFixtures {
  seedVersion: number;
  createdAt: Date;
  applications: DemoApplicationFixture[];
  events: DemoEventFixture[];
}

function daysBefore(anchor: Date, days: number): Date {
  return new Date(anchor.getTime() - days * 86_400_000);
}

export function createDemoFixtures(createdAt = new Date()): DemoFixtures {
  const anchor = new Date(createdAt);
  return {
    seedVersion: DEMO_FIXTURE_VERSION,
    createdAt: anchor,
    applications: [
      {
        demoKey: "northstar-product-engineer",
        company: "Northstar Labs (Fictional Demo)",
        role: "Senior Product Engineer",
        status: "interview",
        appliedAt: daysBefore(anchor, 18),
        lastContact: daysBefore(anchor, 2),
        followUpAt: daysBefore(anchor, -3),
        notes: "Fictional demo opportunity for exploring interviews and follow-ups.",
        source: "demo",
        remote: true,
        salaryMin: 95000,
        salaryMax: 120000,
        rating: 5,
      },
      {
        demoKey: "acme-platform-engineer",
        company: "Acme Cloud (Fictional Demo)",
        role: "Platform Engineer",
        status: "applied",
        appliedAt: daysBefore(anchor, 8),
        lastContact: null,
        followUpAt: daysBefore(anchor, -1),
        notes: "Fictional demo opportunity showing an active application.",
        source: "demo",
        remote: false,
        salaryMin: 85000,
        salaryMax: 105000,
        rating: 4,
      },
      {
        demoKey: "bluebird-backend-engineer",
        company: "Bluebird Systems (Fictional Demo)",
        role: "Backend Engineer",
        status: "inbound",
        appliedAt: null,
        lastContact: null,
        followUpAt: null,
        notes: "Fictional demo lead ready for qualification.",
        source: "demo",
        remote: true,
        salaryMin: null,
        salaryMax: null,
        rating: 3,
      },
    ],
    events: [
      { demoKey: "northstar-discovered", applicationDemoKey: "northstar-product-engineer", type: "opportunity_discovered", occurredAt: daysBefore(anchor, 21), source: "demo", actor: "demo-workspace", metadata: { channel: "website" } },
      { demoKey: "northstar-contact", applicationDemoKey: "northstar-product-engineer", type: "recruiter_contacted", occurredAt: daysBefore(anchor, 2), source: "demo", actor: "demo-workspace", metadata: { channel: "email", outcome: "interview invited" } },
      { demoKey: "northstar-interview", applicationDemoKey: "northstar-product-engineer", type: "interview_scheduled", occurredAt: daysBefore(anchor, 1), source: "demo", actor: "demo-workspace", metadata: { interviewType: "technical", scheduledAt: daysBefore(anchor, -4).toISOString(), durationMinutes: 60 } },
      { demoKey: "acme-discovered", applicationDemoKey: "acme-platform-engineer", type: "opportunity_discovered", occurredAt: daysBefore(anchor, 10), source: "demo", actor: "demo-workspace", metadata: { channel: "referral" } },
      { demoKey: "acme-applied", applicationDemoKey: "acme-platform-engineer", type: "stage_changed", occurredAt: daysBefore(anchor, 8), source: "demo", actor: "demo-workspace", metadata: { fromStage: "inbound", toStage: "applied", toStatus: "applied" } },
      { demoKey: "bluebird-discovered", applicationDemoKey: "bluebird-backend-engineer", type: "opportunity_discovered", occurredAt: daysBefore(anchor, 3), source: "demo", actor: "demo-workspace", metadata: { channel: "linkedin" } },
    ],
  };
}
