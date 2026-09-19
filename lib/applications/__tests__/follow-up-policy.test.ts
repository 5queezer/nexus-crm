import { describe, expect, it } from "vitest";
import { followUpHoldReason } from "../follow-up-policy";
describe("explicit follow-up holds", () => {
  it.each(["Do not follow up yet", "Wait for recruiter feedback", "No follow-up before the recruiter replies", "Don't send a follow up", "Auf Rückmeldung warten", "Keine Nachfrage; kein Follow-up"])("preserves %s", notes => {
    expect(followUpHoldReason({ notes })).toBeTruthy();
  });
  it("does not exclude a normal next action", () => {
    expect(followUpHoldReason({ notes: "Follow up with the recruiter on Monday" })).toBeNull();
  });
  it("honors instructions recorded as the current next action", () => {
    expect(followUpHoldReason({ nextAction: "Wait for recruiter feedback", notes: "" })).toBe("Wait for recruiter feedback");
  });
});
