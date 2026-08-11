import { describe, expect, it } from "vitest";
import { APPLICATION_EVENT_TYPES } from "@/lib/applications/events";
import { STATUS_ORDER } from "@/types";
import { DEMO_FIXTURE_VERSION, createDemoFixtures } from "../fixtures";

describe("demo workspace fixture contract", () => {
  it("creates a bounded, stable, coherent fictional workflow", () => {
    const createdAt = new Date("2026-08-10T12:00:00.000Z");
    const fixture = createDemoFixtures(createdAt);

    expect(DEMO_FIXTURE_VERSION).toBe(1);
    expect(fixture.applications.length).toBeGreaterThanOrEqual(3);
    expect(fixture.applications.length).toBeLessThanOrEqual(6);
    expect(new Set(fixture.applications.map((app) => app.demoKey)).size).toBe(fixture.applications.length);
    expect(fixture.applications.every((app) => STATUS_ORDER.includes(app.status))).toBe(true);
    expect(fixture.applications.every((app) => /demo|fictional/i.test(`${app.company} ${app.notes}`))).toBe(true);

    const appKeys = new Set(fixture.applications.map((app) => app.demoKey));
    expect(fixture.events.length).toBeGreaterThanOrEqual(fixture.applications.length);
    expect(fixture.events.length).toBeLessThanOrEqual(20);
    expect(new Set(fixture.events.map((event) => event.demoKey)).size).toBe(fixture.events.length);
    for (const event of fixture.events) {
      expect(appKeys.has(event.applicationDemoKey)).toBe(true);
      expect(APPLICATION_EVENT_TYPES).toContain(event.type);
      expect(Number.isNaN(event.occurredAt.getTime())).toBe(false);
      expect(event.occurredAt.getTime()).toBeLessThanOrEqual(createdAt.getTime());
    }
  });

  it("is deterministic for the same creation time", () => {
    const createdAt = new Date("2026-08-10T12:00:00.000Z");
    expect(createDemoFixtures(createdAt)).toEqual(createDemoFixtures(createdAt));
  });
});
