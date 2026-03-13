/**
 * Client-side resume analysis engine.
 * Pure JavaScript — no external API calls. All data stays in the browser.
 */

// ── Stop Words ──────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of",
  "with", "by", "from", "as", "is", "was", "are", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "could", "should", "may", "might", "shall", "can", "need", "must",
  "it", "its", "this", "that", "these", "those", "i", "we", "you", "he",
  "she", "they", "me", "us", "him", "her", "them", "my", "our", "your",
  "his", "their", "what", "which", "who", "whom", "when", "where", "why",
  "how", "all", "each", "every", "both", "few", "more", "most", "other",
  "some", "such", "no", "nor", "not", "only", "own", "same", "so", "than",
  "too", "very", "just", "because", "if", "while", "about", "up", "out",
  "also", "into", "over", "after", "before", "between", "under", "again",
  "then", "once", "here", "there", "any", "etc", "e.g", "i.e", "vs",
  "via", "per", "plus", "well", "new", "get", "like", "make", "using",
  "used", "use", "work", "working", "including", "include", "across",
  "within", "through", "during", "able", "ability", "based", "ensure",
  "role", "team", "experience", "years", "year", "strong", "looking",
  "join", "company", "position", "ideal", "candidate", "responsible",
  "responsibilities", "requirement", "requirements", "qualifications",
  "qualification", "preferred", "required", "minimum", "desired", "must",
  "will", "opportunity", "apply", "job", "description", "overview",
  "summary", "duties", "benefits", "salary", "location", "department",
]);

// ── Skill Dictionaries ──────────────────────────────────────────────────────

export const TECHNICAL_SKILLS: string[] = [
  // Programming languages
  "javascript", "typescript", "python", "java", "c++", "c#", "go", "golang",
  "rust", "ruby", "php", "swift", "kotlin", "scala", "r", "matlab",
  "perl", "haskell", "elixir", "clojure", "dart", "lua", "sql", "nosql",
  // Frontend
  "react", "react.js", "reactjs", "next.js", "nextjs", "angular", "vue",
  "vue.js", "vuejs", "svelte", "html", "css", "sass", "scss", "less",
  "tailwind", "tailwindcss", "bootstrap", "material ui", "mui",
  "redux", "mobx", "zustand", "graphql", "rest", "restful",
  "webpack", "vite", "rollup", "babel", "eslint", "prettier",
  // Backend
  "node.js", "nodejs", "express", "express.js", "fastify", "nest.js",
  "nestjs", "django", "flask", "fastapi", "spring", "spring boot",
  ".net", "asp.net", "rails", "ruby on rails", "laravel", "symfony",
  // Databases
  "postgresql", "postgres", "mysql", "mongodb", "redis", "elasticsearch",
  "dynamodb", "cassandra", "sqlite", "oracle", "sql server", "mariadb",
  "firestore", "firebase", "supabase", "prisma", "sequelize", "typeorm",
  // Cloud & DevOps
  "aws", "azure", "gcp", "google cloud", "docker", "kubernetes", "k8s",
  "terraform", "ansible", "jenkins", "ci/cd", "github actions",
  "gitlab ci", "circleci", "linux", "nginx", "apache",
  // Data & ML
  "machine learning", "deep learning", "artificial intelligence", "ai",
  "natural language processing", "nlp", "computer vision", "tensorflow",
  "pytorch", "scikit-learn", "pandas", "numpy", "spark", "hadoop",
  "data science", "data engineering", "data analysis", "etl",
  "big data", "tableau", "power bi", "looker",
  // Mobile
  "react native", "flutter", "ios", "android", "swiftui", "jetpack compose",
  // Testing
  "jest", "mocha", "cypress", "playwright", "selenium", "testing library",
  "unit testing", "integration testing", "e2e testing", "tdd", "bdd",
  // Tools
  "git", "github", "gitlab", "bitbucket", "jira", "confluence",
  "figma", "sketch", "adobe xd", "storybook", "postman",
  // Architecture & Patterns
  "microservices", "monolith", "serverless", "event-driven",
  "api design", "system design", "design patterns", "solid",
  "domain-driven design", "ddd", "clean architecture",
  // Security
  "oauth", "jwt", "authentication", "authorization", "encryption",
  "ssl", "tls", "penetration testing", "owasp",
  // Protocols & Standards
  "http", "https", "websocket", "grpc", "mqtt", "tcp/ip",
  "json", "xml", "yaml", "protobuf",
  // Misc
  "agile", "scrum", "kanban", "lean", "devops", "sre",
  "accessibility", "a11y", "i18n", "internationalization",
  "seo", "performance optimization", "responsive design",
  "progressive web app", "pwa", "single page application", "spa",
  "saas", "paas", "iaas",
];

export const SOFT_SKILLS: string[] = [
  "communication", "leadership", "teamwork", "collaboration",
  "problem solving", "problem-solving", "critical thinking",
  "time management", "project management", "adaptability",
  "creativity", "attention to detail", "organizational",
  "interpersonal", "negotiation", "conflict resolution",
  "decision making", "decision-making", "mentoring", "coaching",
  "presentation", "public speaking", "stakeholder management",
  "cross-functional", "self-motivated", "proactive",
  "analytical", "strategic thinking", "initiative",
  "multitasking", "prioritization", "delegation",
  "emotional intelligence", "empathy", "resilience",
  "accountability", "ownership", "customer focus",
];

export const QUALIFICATIONS: string[] = [
  "bachelor", "master", "phd", "mba", "degree", "certification",
  "certified", "diploma", "associate degree", "computer science",
  "software engineering", "information technology", "mathematics",
  "statistics", "data science", "electrical engineering",
  "mechanical engineering", "business administration",
  "aws certified", "azure certified", "google certified",
  "pmp", "scrum master", "csm", "cspo", "safe",
  "cissp", "ceh", "comptia", "cka", "ckad",
];

// ── Action Verbs ────────────────────────────────────────────────────────────

export const ACTION_VERBS: string[] = [
  "achieved", "accomplished", "accelerated", "administered", "analyzed",
  "architected", "automated", "built", "championed", "collaborated",
  "configured", "consolidated", "contributed", "coordinated", "created",
  "debugged", "delivered", "deployed", "designed", "developed",
  "directed", "documented", "drove", "eliminated", "enabled",
  "engineered", "enhanced", "established", "evaluated", "executed",
  "expanded", "facilitated", "formulated", "generated", "guided",
  "identified", "implemented", "improved", "increased", "influenced",
  "initiated", "innovated", "integrated", "introduced", "launched",
  "led", "leveraged", "maintained", "managed", "mentored",
  "migrated", "modernized", "monitored", "negotiated", "optimized",
  "orchestrated", "organized", "oversaw", "overhauled", "piloted",
  "pioneered", "planned", "presented", "prioritized", "produced",
  "proposed", "published", "redesigned", "reduced", "refactored",
  "resolved", "restructured", "revamped", "scaled", "simplified",
  "solved", "spearheaded", "standardized", "streamlined", "strengthened",
  "supervised", "supported", "surpassed", "tested", "trained",
  "transformed", "troubleshot", "unified", "upgraded", "utilized",
];

// ── Types ───────────────────────────────────────────────────────────────────

export type SkillCategory = "technical" | "soft" | "qualification" | "other";

export interface ExtractedKeyword {
  term: string;
  category: SkillCategory;
  found: boolean;
}

export interface FormattingTip {
  type: "success" | "warning" | "error";
  message: string;
  messageKey: string;
  messageParams?: Record<string, string | number>;
}

export interface AnalysisResult {
  matchScore: number;
  keywords: ExtractedKeyword[];
  matchedCount: number;
  missingCount: number;
  formattingTips: FormattingTip[];
  wordCount: number;
  estimatedReadTimeMinutes: number;
  categoryCounts: Record<SkillCategory, { total: number; matched: number }>;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\w\s.#+\-/]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(text: string): string[] {
  return normalize(text).split(/\s+/).filter((w) => w.length > 1);
}

function extractPhrases(text: string): Set<string> {
  const norm = normalize(text);
  const phrases = new Set<string>();

  // Check known multi-word skills
  const allKnownPhrases = [
    ...TECHNICAL_SKILLS,
    ...SOFT_SKILLS,
    ...QUALIFICATIONS,
  ].filter((s) => s.includes(" ") || s.includes("-"));

  for (const phrase of allKnownPhrases) {
    if (norm.includes(phrase.toLowerCase())) {
      phrases.add(phrase.toLowerCase());
    }
  }

  // Also extract individual meaningful words
  const words = tokenize(text);
  for (const word of words) {
    if (!STOP_WORDS.has(word) && word.length > 2) {
      phrases.add(word);
    }
  }

  return phrases;
}

function categorizeSkill(term: string): SkillCategory {
  const lower = term.toLowerCase();
  if (TECHNICAL_SKILLS.some((s) => s.toLowerCase() === lower)) return "technical";
  if (SOFT_SKILLS.some((s) => s.toLowerCase() === lower)) return "soft";
  if (QUALIFICATIONS.some((s) => s.toLowerCase() === lower)) return "qualification";
  return "other";
}

function checkContains(resumeNorm: string, term: string): boolean {
  const lower = term.toLowerCase();
  // For multi-word terms, check direct inclusion
  if (lower.includes(" ") || lower.includes("-")) {
    // Normalize hyphen variants
    const variants = [lower, lower.replace(/-/g, " "), lower.replace(/ /g, "-")];
    return variants.some((v) => resumeNorm.includes(v));
  }
  // For single-word terms, use word boundary matching
  const escaped = lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`\\b${escaped}\\b`, "i");
  return regex.test(resumeNorm);
}

// ── Main Analysis ───────────────────────────────────────────────────────────

export function analyzeResume(resumeText: string, jobDescription: string): AnalysisResult {
  const resumeNorm = normalize(resumeText);
  const jdPhrases = extractPhrases(jobDescription);

  // Filter out very generic words that aren't in our skill dictionaries
  const allSkills = new Set([
    ...TECHNICAL_SKILLS.map((s) => s.toLowerCase()),
    ...SOFT_SKILLS.map((s) => s.toLowerCase()),
    ...QUALIFICATIONS.map((s) => s.toLowerCase()),
  ]);

  // Prioritize known skills from JD, then keep other meaningful terms
  const keywords: ExtractedKeyword[] = [];
  const seen = new Set<string>();

  for (const phrase of jdPhrases) {
    const lower = phrase.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);

    const category = categorizeSkill(lower);
    // Skip "other" category single words that are very short or too generic
    if (category === "other" && lower.length <= 3 && !allSkills.has(lower)) continue;

    keywords.push({
      term: phrase,
      category,
      found: checkContains(resumeNorm, lower),
    });
  }

  // Sort: known skills first, then by category, then alphabetically
  const categoryOrder: Record<SkillCategory, number> = {
    technical: 0,
    soft: 1,
    qualification: 2,
    other: 3,
  };
  keywords.sort((a, b) => {
    const catDiff = categoryOrder[a.category] - categoryOrder[b.category];
    if (catDiff !== 0) return catDiff;
    return a.term.localeCompare(b.term);
  });

  const matchedCount = keywords.filter((k) => k.found).length;
  const missingCount = keywords.filter((k) => !k.found).length;
  const matchScore = keywords.length > 0
    ? Math.round((matchedCount / keywords.length) * 100)
    : 0;

  // Category counts
  const categoryCounts: Record<SkillCategory, { total: number; matched: number }> = {
    technical: { total: 0, matched: 0 },
    soft: { total: 0, matched: 0 },
    qualification: { total: 0, matched: 0 },
    other: { total: 0, matched: 0 },
  };
  for (const kw of keywords) {
    categoryCounts[kw.category].total++;
    if (kw.found) categoryCounts[kw.category].matched++;
  }

  // Formatting tips
  const formattingTips = generateFormattingTips(resumeText);

  // Word count & read time
  const words = resumeText.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const estimatedReadTimeMinutes = Math.max(1, Math.round(wordCount / 200));

  return {
    matchScore,
    keywords,
    matchedCount,
    missingCount,
    formattingTips,
    wordCount,
    estimatedReadTimeMinutes,
    categoryCounts,
  };
}

// ── Formatting Tips ─────────────────────────────────────────────────────────

function generateFormattingTips(resumeText: string): FormattingTip[] {
  const tips: FormattingTip[] = [];
  const words = resumeText.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const lines = resumeText.split("\n");
  const lowerText = resumeText.toLowerCase();

  // Word count check
  if (wordCount < 100) {
    tips.push({
      type: "error",
      message: `Resume is very short (${wordCount} words). Aim for 400-800 words.`,
      messageKey: "tip_too_short",
      messageParams: { count: wordCount },
    });
  } else if (wordCount < 300) {
    tips.push({
      type: "warning",
      message: `Resume is short (${wordCount} words). Consider adding more detail. Aim for 400-800 words.`,
      messageKey: "tip_short",
      messageParams: { count: wordCount },
    });
  } else if (wordCount > 1200) {
    tips.push({
      type: "warning",
      message: `Resume is long (${wordCount} words). Consider trimming to 600-800 words for best readability.`,
      messageKey: "tip_long",
      messageParams: { count: wordCount },
    });
  } else {
    tips.push({
      type: "success",
      message: `Good resume length (${wordCount} words).`,
      messageKey: "tip_good_length",
      messageParams: { count: wordCount },
    });
  }

  // Action verbs check
  const resumeWords = words.map((w) => w.toLowerCase().replace(/[^a-z]/g, ""));
  const foundVerbs = ACTION_VERBS.filter((v) => resumeWords.includes(v));
  if (foundVerbs.length >= 5) {
    tips.push({
      type: "success",
      message: `Great use of action verbs (${foundVerbs.length} found).`,
      messageKey: "tip_good_verbs",
      messageParams: { count: foundVerbs.length },
    });
  } else if (foundVerbs.length >= 2) {
    tips.push({
      type: "warning",
      message: `Only ${foundVerbs.length} action verbs found. Use more verbs like: achieved, implemented, designed, led, optimized.`,
      messageKey: "tip_few_verbs",
      messageParams: { count: foundVerbs.length },
    });
  } else {
    tips.push({
      type: "error",
      message: "Very few action verbs found. Start bullet points with strong verbs like: achieved, built, designed, implemented, led.",
      messageKey: "tip_no_verbs",
    });
  }

  // Quantified achievements
  const numberPattern = /\b\d+[%+]?\b/g;
  const numbers = resumeText.match(numberPattern) || [];
  const metricsCount = numbers.length;
  if (metricsCount >= 3) {
    tips.push({
      type: "success",
      message: `Good use of quantified achievements (${metricsCount} numbers/metrics found).`,
      messageKey: "tip_good_metrics",
      messageParams: { count: metricsCount },
    });
  } else {
    tips.push({
      type: "warning",
      message: "Add more quantified achievements (e.g., \"Increased performance by 40%\", \"Managed team of 8\").",
      messageKey: "tip_few_metrics",
    });
  }

  // Section headers check
  const commonSections = [
    "experience", "education", "skills", "projects", "summary",
    "objective", "profile", "certifications", "achievements",
    "work history", "technical skills", "professional experience",
    // German equivalents
    "erfahrung", "ausbildung", "fähigkeiten", "projekte", "zusammenfassung",
    "berufserfahrung", "kenntnisse", "zertifizierungen",
  ];
  const foundSections = commonSections.filter((s) => lowerText.includes(s));
  if (foundSections.length >= 3) {
    tips.push({
      type: "success",
      message: `Well-structured with ${foundSections.length} identifiable sections.`,
      messageKey: "tip_good_sections",
      messageParams: { count: foundSections.length },
    });
  } else if (foundSections.length >= 1) {
    tips.push({
      type: "warning",
      message: "Consider adding clear section headers (Experience, Education, Skills, Projects).",
      messageKey: "tip_few_sections",
    });
  } else {
    tips.push({
      type: "error",
      message: "No clear section headers detected. Add headers like: Experience, Education, Skills, Projects.",
      messageKey: "tip_no_sections",
    });
  }

  // Contact info check
  const hasEmail = /[\w.-]+@[\w.-]+\.\w+/.test(resumeText);
  const hasPhone = /[\+]?[\d\s\-().]{7,}/.test(resumeText);
  const hasLinkedIn = /linkedin/i.test(resumeText);
  if (hasEmail && (hasPhone || hasLinkedIn)) {
    tips.push({
      type: "success",
      message: "Contact information detected.",
      messageKey: "tip_has_contact",
    });
  } else {
    tips.push({
      type: "warning",
      message: "Include contact information (email, phone, LinkedIn).",
      messageKey: "tip_no_contact",
    });
  }

  // Bullet points / line density
  const bulletLines = lines.filter((l) => /^\s*[•\-\*▪◦]/.test(l)).length;
  if (bulletLines >= 5) {
    tips.push({
      type: "success",
      message: "Good use of bullet points for readability.",
      messageKey: "tip_good_bullets",
    });
  } else if (lines.length > 10 && bulletLines < 3) {
    tips.push({
      type: "warning",
      message: "Consider using bullet points to improve readability.",
      messageKey: "tip_few_bullets",
    });
  }

  return tips;
}
