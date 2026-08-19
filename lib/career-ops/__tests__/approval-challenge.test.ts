import { describe, expect, it } from "vitest";
import {
  approvalActionHash,
  issueApprovalChallenge,
  verifyApprovalChallenge,
} from "../approval-challenge";
import type { CareerOpsConfig } from "../config";

const config = { scopeSecret: "test-scope-secret" } as Extract<
  CareerOpsConfig,
  { enabled: true }
>;

const ACTION = { operation: "shell", summary: "Update the application", details: "nexus update 42" };

function mint(overrides: Partial<Parameters<typeof issueApprovalChallenge>[1]> = {}) {
  return issueApprovalChallenge(config, {
    runId: "run-1",
    userId: "user-a",
    actionHash: approvalActionHash(ACTION),
    choices: ["once", "deny"],
    ...overrides,
  });
}

describe("approval challenge", () => {
  it("accepts the choice that was actually offered", () => {
    const result = verifyApprovalChallenge(config, mint(), {
      runId: "run-1",
      userId: "user-a",
      choice: "once",
    });
    expect(result.ok).toBe(true);
  });

  it("refuses a decision with no challenge at all", () => {
    for (const token of [undefined, null, "", 42, {}]) {
      expect(
        verifyApprovalChallenge(config, token, {
          runId: "run-1",
          userId: "user-a",
          choice: "once",
        }),
      ).toMatchObject({ ok: false });
    }
  });

  it("refuses a choice the gate never advertised", () => {
    // The attack this exists for: the prompt offered `once`, a direct request
    // asks for `always` and would otherwise widen the grant to every future
    // invocation without the human ever being offered that.
    const token = mint({ choices: ["once", "deny"] });
    expect(
      verifyApprovalChallenge(config, token, {
        runId: "run-1",
        userId: "user-a",
        choice: "always",
      }),
    ).toMatchObject({ ok: false, reason: "mismatch" });
  });

  it("refuses a challenge minted for a different run", () => {
    expect(
      verifyApprovalChallenge(config, mint({ runId: "run-other" }), {
        runId: "run-1",
        userId: "user-a",
        choice: "once",
      }),
    ).toMatchObject({ ok: false, reason: "mismatch" });
  });

  it("refuses a challenge minted for a different user", () => {
    expect(
      verifyApprovalChallenge(config, mint({ userId: "user-b" }), {
        runId: "run-1",
        userId: "user-a",
        choice: "once",
      }),
    ).toMatchObject({ ok: false, reason: "mismatch" });
  });

  it("refuses a forged or tampered token", () => {
    const token = mint();
    const [version, body, signature] = token.split(".");
    const tampered = Buffer.from(
      JSON.stringify({
        runId: "run-1",
        userId: "user-a",
        actionHash: approvalActionHash(ACTION),
        choices: ["once", "session", "always", "deny"],
        issuedAt: Date.now(),
        jti: "forged",
      }),
      "utf8",
    ).toString("base64url");

    expect(
      verifyApprovalChallenge(config, `${version}.${tampered}.${signature}`, {
        runId: "run-1",
        userId: "user-a",
        choice: "always",
      }),
    ).toMatchObject({ ok: false, reason: "bad_signature" });

    expect(
      verifyApprovalChallenge({ scopeSecret: "other-secret" } as typeof config, token, {
        runId: "run-1",
        userId: "user-a",
        choice: "once",
      }),
    ).toMatchObject({ ok: false, reason: "bad_signature" });

    expect(
      verifyApprovalChallenge(config, `${version}.${body}.${signature}x`, {
        runId: "run-1",
        userId: "user-a",
        choice: "once",
      }),
    ).toMatchObject({ ok: false });
  });

  it("refuses a stale prompt", () => {
    const token = mint({ now: Date.now() - 60 * 60_000 });
    expect(
      verifyApprovalChallenge(config, token, {
        runId: "run-1",
        userId: "user-a",
        choice: "once",
      }),
    ).toMatchObject({ ok: false, reason: "expired" });
  });

  it("refuses an oversized token without parsing it", () => {
    expect(
      verifyApprovalChallenge(config, `v1.${"a".repeat(5000)}.sig`, {
        runId: "run-1",
        userId: "user-a",
        choice: "once",
      }),
    ).toMatchObject({ ok: false, reason: "malformed" });
  });

  it("gives a different action a different hash", () => {
    // A token minted for one action must never authorize another, so any change
    // to what was displayed has to change the digest.
    expect(approvalActionHash(ACTION)).not.toBe(
      approvalActionHash({ ...ACTION, details: "nexus delete 42" }),
    );
    expect(approvalActionHash(ACTION)).toBe(approvalActionHash({ ...ACTION }));
  });
});
