import { describe, expect, it } from "vitest";
import { followUpHoldReason } from "../follow-up-policy";
describe("explicit follow-up holds", () => {
  it.each(["Do not follow up yet", "Wait for recruiter feedback", "No follow-up before the recruiter replies", "Don't send a follow up", "Auf Rückmeldung warten", "Keine Nachfrage; kein Follow-up", "Bitte kein Follow-up vor der Rückmeldung", "Nächster Schritt: Auf Rückmeldung warten"])("preserves %s", notes => {
    expect(followUpHoldReason({ notes })).toBeTruthy();
  });
  it("does not exclude a normal next action", () => {
    expect(followUpHoldReason({ notes: "Follow up with the recruiter on Monday" })).toBeNull();
  });
  it("honors instructions recorded as the current next action", () => {
    expect(followUpHoldReason({ nextAction: "Wait for recruiter feedback", notes: "" })).toBe("Wait for recruiter feedback");
  });

  it.each([
    "No follow-up received from the recruiter",
    "No follow-up yet from the recruiter",
    "We waited for recruiter feedback before deciding what to do",
    "I was told to wait for a response last week",
    "The recruiter did not follow up yet",
    "Keine Nachfrage erhalten",
    "Kein Follow-up erhalten",
  ])("does not treat historical notes as a current hold: %s", (notes) => {
    expect(followUpHoldReason({ notes })).toBeNull();
  });

  it("recognizes a clear hold clause after historical context", () => {
    expect(followUpHoldReason({ notes: "Recruiter called yesterday; do not follow up yet" }))
      .toBe("do not follow up yet");
  });
});
