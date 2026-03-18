import { describe, it, expect } from "vitest";
import { classifyEmail } from "../classifier";

const email = (
  subject: string,
  sender = "HR Team <hr@example.com>",
  bodySnippet = ""
) => ({ subject, sender, bodySnippet });

describe("classifyEmail", () => {
  describe("application confirmations", () => {
    it("detects 'thank you for applying'", () => {
      const r = classifyEmail(email("Thank you for applying to our team"));
      expect(r.classification).toBe("applied");
      expect(r.confidence).toBe("high");
    });

    it("detects 'application received'", () => {
      const r = classifyEmail(email("Your application received"));
      expect(r.classification).toBe("applied");
    });

    it("detects German 'Bewerbung eingegangen'", () => {
      const r = classifyEmail(email("Bewerbung eingegangen"));
      expect(r.classification).toBe("applied");
    });

    it("detects German 'Vielen Dank für Ihre Bewerbung'", () => {
      const r = classifyEmail(email("Vielen Dank für Ihre Bewerbung"));
      expect(r.classification).toBe("applied");
    });
  });

  describe("interview invitations", () => {
    it("detects 'interview invitation'", () => {
      const r = classifyEmail(email("Interview invitation - Software Engineer"));
      expect(r.classification).toBe("interview");
      expect(r.confidence).toBe("high");
    });

    it("detects 'schedule a call'", () => {
      const r = classifyEmail(email("We'd like to schedule a call with you"));
      expect(r.classification).toBe("interview");
    });

    it("detects German 'Einladung zum Vorstellungsgespräch'", () => {
      const r = classifyEmail(email("Einladung zum Vorstellungsgespräch"));
      expect(r.classification).toBe("interview");
    });

    it("detects 'we'd love to meet'", () => {
      const r = classifyEmail(email("We'd love to meet you"));
      expect(r.classification).toBe("interview");
    });
  });

  describe("rejections", () => {
    it("detects 'unfortunately'", () => {
      const r = classifyEmail(email("Unfortunately, we are not moving forward"));
      expect(r.classification).toBe("rejection");
      expect(r.confidence).toBe("high");
    });

    it("detects 'not been selected'", () => {
      const r = classifyEmail(email("You have not been selected"));
      expect(r.classification).toBe("rejection");
    });

    it("detects German 'Absage'", () => {
      const r = classifyEmail(email("Absage auf Ihre Bewerbung"));
      expect(r.classification).toBe("rejection");
    });

    it("detects 'position has been filled'", () => {
      const r = classifyEmail(email("The position has been filled"));
      expect(r.classification).toBe("rejection");
    });
  });

  describe("offers", () => {
    it("detects 'offer letter'", () => {
      const r = classifyEmail(email("Your offer letter"));
      expect(r.classification).toBe("offer");
      expect(r.confidence).toBe("high");
    });

    it("detects 'pleased to offer'", () => {
      const r = classifyEmail(email("We're pleased to offer you the position"));
      expect(r.classification).toBe("offer");
    });

    it("detects German 'Zusage'", () => {
      const r = classifyEmail(email("Zusage: Ihre Bewerbung"));
      expect(r.classification).toBe("offer");
    });
  });

  describe("body-based classification (medium confidence)", () => {
    it("detects applied from body snippet", () => {
      const r = classifyEmail(
        email("No subject clue", "hr@example.com", "Thank you for applying to our company")
      );
      expect(r.classification).toBe("applied");
      expect(r.confidence).toBe("medium");
    });

    it("detects interview from body snippet", () => {
      const r = classifyEmail(
        email("Follow up", "hr@example.com", "Please choose an interview calendar slot")
      );
      expect(r.classification).toBe("interview");
      expect(r.confidence).toBe("medium");
    });

    it("detects rejection from body snippet", () => {
      const r = classifyEmail(
        email("Update", "hr@example.com", "Unfortunately we have decided to go in a different direction")
      );
      expect(r.classification).toBe("rejection");
      expect(r.confidence).toBe("medium");
    });

    it("detects offer from body snippet", () => {
      const r = classifyEmail(
        email("Next steps", "hr@example.com", "Please review the attached offer letter and compensation package")
      );
      expect(r.classification).toBe("offer");
      expect(r.confidence).toBe("medium");
    });
  });

  describe("job board sender fallback", () => {
    it("classifies as low-confidence applied for known job board", () => {
      const r = classifyEmail(
        email("Your weekly update", "notifications@linkedin.com", "Here are your job alerts")
      );
      expect(r.classification).toBe("applied");
      expect(r.confidence).toBe("low");
    });

    it("matches subdomains of job boards", () => {
      const r = classifyEmail(
        email("Update", "noreply@mail.greenhouse.io", "Some content")
      );
      expect(r.classification).toBe("applied");
      expect(r.confidence).toBe("low");
    });
  });

  describe("no match", () => {
    it("returns null classification for unrelated emails", () => {
      const r = classifyEmail(
        email("Your pizza order", "orders@pizza.com", "Your pizza is on the way")
      );
      expect(r.classification).toBeNull();
      expect(r.confidence).toBe("low");
    });
  });

  describe("company extraction", () => {
    it("extracts company from 'at Company' pattern", () => {
      const r = classifyEmail(
        email("Application received", "Recruiting at Acme Corp <noreply@acme.com>")
      );
      expect(r.company).toBe("Acme Corp");
    });

    it("extracts company from display name", () => {
      const r = classifyEmail(
        email("Application received", "Tesla Motors <careers@tesla.com>")
      );
      expect(r.company).toBe("Tesla Motors");
    });

    it("falls back to domain name", () => {
      const r = classifyEmail(
        email("Application received", "noreply@stripe.com")
      );
      expect(r.company).toBe("Stripe");
    });

    it("returns null for known job board domains", () => {
      const r = classifyEmail(
        email("Application received", "noreply@linkedin.com")
      );
      expect(r.company).toBeNull();
    });
  });

  describe("role extraction", () => {
    it("extracts role from 'application for' pattern", () => {
      const r = classifyEmail(
        email("Your application for Senior Engineer")
      );
      expect(r.role).toBe("Senior Engineer");
    });

    it("extracts role from German 'Bewerbung als' pattern", () => {
      const r = classifyEmail(
        email("Bewerbung als Software Entwickler")
      );
      expect(r.role).toBe("Software Entwickler");
    });

    it("returns null when no role pattern matches", () => {
      const r = classifyEmail(email("Thank you for applying"));
      expect(r.role).toBeNull();
    });
  });
});
