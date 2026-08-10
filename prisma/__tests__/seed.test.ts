import { describe, expect, it, vi } from "vitest";
import { runDemoSeed } from "../seed";

describe("demo seed lifecycle client", () => {
  const adapter = { ensureDemoWorkspace: vi.fn() };

  it("rejects production before resolving an adapter", async () => {
    const resolveAdapter = vi.fn();
    await expect(runDemoSeed({ NODE_ENV: "production", DEMO_SEED_USER_ID: "owner-1" }, resolveAdapter)).rejects.toThrow("production");
    expect(resolveAdapter).not.toHaveBeenCalled();
  });

  it("requires an explicit user before resolving an adapter", async () => {
    const resolveAdapter = vi.fn();
    await expect(runDemoSeed({
      NODE_ENV: "development",
      DEMO_SEED_ENABLED: "true",
    }, resolveAdapter)).rejects.toThrow("DEMO_SEED_USER_ID");
    expect(resolveAdapter).not.toHaveBeenCalled();
  });

  it("requires an explicit positive seed opt-in before resolving an adapter", async () => {
    const resolveAdapter = vi.fn();
    await expect(runDemoSeed({
      NODE_ENV: "development",
      DEMO_SEED_USER_ID: "owner-1",
    }, resolveAdapter)).rejects.toThrow("DEMO_SEED_ENABLED=true");
    expect(resolveAdapter).not.toHaveBeenCalled();
  });

  it("uses the configured provider-neutral adapter lifecycle and reports replay", async () => {
    adapter.ensureDemoWorkspace.mockResolvedValue({ replayed: true, applications: [] });
    const resolveAdapter = vi.fn(() => adapter);
    const result = await runDemoSeed({
      NODE_ENV: "development",
      DEMO_SEED_ENABLED: "true",
      DEMO_SEED_USER_ID: "owner-1",
    }, resolveAdapter);
    expect(resolveAdapter).toHaveBeenCalledOnce();
    expect(adapter.ensureDemoWorkspace).toHaveBeenCalledWith("owner-1", expect.objectContaining({ seedVersion: 1 }));
    expect(result.replayed).toBe(true);
  });
});
