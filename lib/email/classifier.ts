export interface ClassificationResult {
  classification: "applied" | "interview" | "rejection" | "offer" | null;
  confidence: "high" | "medium" | "low";
  company: string | null;
  role: string | null;
}

interface EmailInput {
  subject: string;
  sender: string;
  bodySnippet: string; // first ~500 chars of plaintext body
}

// ── Pattern-based rules (Tier 1) ─────────────────────────────────────────────

interface Rule {
  pattern: RegExp;
  classification: ClassificationResult["classification"];
}

const SUBJECT_RULES: Rule[] = [
  // Applied / confirmation
  { pattern: /thank you for (applying|your application|your interest)/i, classification: "applied" },
  { pattern: /application (received|confirmed|submitted)/i, classification: "applied" },
  { pattern: /we (have )?received your application/i, classification: "applied" },
  { pattern: /bewerbung (eingegangen|erhalten|bestätigt)/i, classification: "applied" },
  { pattern: /vielen dank für (ihre|deine) bewerbung/i, classification: "applied" },

  // Interview
  { pattern: /interview (invitation|schedule|request|confirmation)/i, classification: "interview" },
  { pattern: /einladung zum (vorstellungs)?gespräch/i, classification: "interview" },
  { pattern: /schedule.{0,20}(call|chat|meeting|interview)/i, classification: "interview" },
  { pattern: /we('d| would) (like|love) to (meet|speak|chat|talk|invite)/i, classification: "interview" },

  // Rejection
  { pattern: /(unfortunately|regret to inform|not moving forward|not (been )?selected)/i, classification: "rejection" },
  { pattern: /position has been filled/i, classification: "rejection" },
  { pattern: /absage|leider (müssen wir|können wir)/i, classification: "rejection" },
  { pattern: /we (have )?decided (to )?(not |go with|move forward with (another|other))/i, classification: "rejection" },

  // Offer
  { pattern: /offer (letter|of employment|extended)/i, classification: "offer" },
  { pattern: /we('re| are) (pleased|happy|excited) to offer/i, classification: "offer" },
  { pattern: /job offer/i, classification: "offer" },
  { pattern: /angebot|zusage/i, classification: "offer" },
];

const BODY_RULES: Rule[] = [
  { pattern: /thank you for (applying|submitting your application|your interest in)/i, classification: "applied" },
  { pattern: /interview.{0,30}(schedule|calendar|invite|slot)/i, classification: "interview" },
  { pattern: /(unfortunately|regret).{0,60}(not|unable|different direction)/i, classification: "rejection" },
  { pattern: /offer.{0,20}(letter|package|compensation|salary|position)/i, classification: "offer" },
];

// Known job board sender domains
const JOB_BOARD_DOMAINS = [
  "linkedin.com",
  "indeed.com",
  "greenhouse.io",
  "lever.co",
  "workday.com",
  "smartrecruiters.com",
  "jobs.ashbyhq.com",
  "myworkday.com",
  "icims.com",
  "jobvite.com",
  "breezy.hr",
  "recruitee.com",
  "stepstone.de",
  "xing.com",
  "ams.at",
];

function extractDomain(sender: string): string {
  const match = sender.match(/@([a-z0-9.-]+)/i);
  return match ? match[1].toLowerCase() : "";
}

function isJobRelatedSender(sender: string): boolean {
  const domain = extractDomain(sender);
  return JOB_BOARD_DOMAINS.some(
    (d) => domain === d || domain.endsWith("." + d)
  );
}

/**
 * Extract company name from sender address/name.
 * e.g. "Recruiting Team at Acme Corp <noreply@acme.com>" → "Acme Corp"
 */
function extractCompany(sender: string): string | null {
  // Try "at Company" pattern in display name
  const atMatch = sender.match(/ at ([^<]+)/i);
  if (atMatch) return atMatch[1].trim();

  // Try "Company Name <email>" pattern
  const nameMatch = sender.match(/^([^<]+)</);
  if (nameMatch) {
    const name = nameMatch[1].trim();
    // Filter out generic names
    if (name && !name.match(/^(noreply|no-reply|careers|jobs|recruiting|hr|talent)/i)) {
      return name;
    }
  }

  // Fall back to domain (strip TLD and common prefixes)
  const domain = extractDomain(sender);
  if (domain) {
    const parts = domain.split(".");
    // Skip known job boards
    if (!JOB_BOARD_DOMAINS.some((d) => domain === d || domain.endsWith("." + d))) {
      return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    }
  }

  return null;
}

/**
 * Try to extract role from subject line.
 * e.g. "Your application for Senior Engineer" → "Senior Engineer"
 */
function extractRole(subject: string): string | null {
  const patterns = [
    /application for (?:the )?(?:position of )?(.+?)(?:\s*[-–|]|$)/i,
    /bewerbung (?:als|für) (.+?)(?:\s*[-–|]|$)/i,
    /(?:re|regarding|position):?\s*(.+?)(?:\s*[-–|]|$)/i,
  ];
  for (const p of patterns) {
    const m = subject.match(p);
    if (m && m[1].trim().length > 2 && m[1].trim().length < 80) {
      return m[1].trim();
    }
  }
  return null;
}

/**
 * Classify an email using pattern matching.
 * Returns null classification if no pattern matches.
 */
export function classifyEmail(email: EmailInput): ClassificationResult {
  const company = extractCompany(email.sender);
  const role = extractRole(email.subject);

  // Check subject-line rules first (higher confidence)
  for (const rule of SUBJECT_RULES) {
    if (rule.pattern.test(email.subject)) {
      return {
        classification: rule.classification,
        confidence: "high",
        company,
        role,
      };
    }
  }

  // Check body rules (medium confidence)
  for (const rule of BODY_RULES) {
    if (rule.pattern.test(email.bodySnippet)) {
      return {
        classification: rule.classification,
        confidence: "medium",
        company,
        role,
      };
    }
  }

  // If sender is from a known job board but no pattern matched
  if (isJobRelatedSender(email.sender)) {
    return {
      classification: "applied",
      confidence: "low",
      company,
      role,
    };
  }

  // No match
  return {
    classification: null,
    confidence: "low",
    company,
    role,
  };
}
