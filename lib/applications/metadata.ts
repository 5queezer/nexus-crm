import { canonicalizeJobUrl } from "./submission";
import type { StructuredApplicationMetadataInput } from "@/lib/db/types";

const WORK_MODES = new Set(["remote", "hybrid", "onsite", "flexible"]);
const SALARY_PERIODS = new Set(["year", "month", "day", "hour"]);
const SALARY_TYPES = new Set(["base", "total", "contract_rate"]);
const JOB_LIVENESS = new Set(["unknown", "live", "closed", "expired"]);

function optionalString(value: unknown, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return String(value).trim().slice(0, max) || null;
}

function optionalEnum(
  value: unknown,
  allowed: Set<string>,
  field: string,
): string | null | undefined {
  const parsed = optionalString(value, 100);
  if (parsed == null) return parsed;
  if (!allowed.has(parsed)) throw new Error(`${field}_invalid`);
  return parsed;
}

function optionalInteger(
  value: unknown,
  field: string,
  min: number,
  max: number,
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${field}_invalid`);
  }
  return parsed;
}

function optionalBoolean(value: unknown): boolean | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error("boolean_invalid");
}

function optionalDate(value: unknown, field: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error(`${field}_invalid`);
  return date;
}

function optionalStringArray(
  value: unknown,
  field: string,
  maxItems: number,
  itemMax: number,
): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${field}_invalid`);
  return Array.from(
    new Set(value.map((item) => String(item).trim().slice(0, itemMax)).filter(Boolean)),
  );
}

export function parseStructuredApplicationMetadata(
  input: Record<string, unknown>,
): StructuredApplicationMetadataInput {
  if (
    input.eligibleCountries !== undefined &&
    input.eligibleCountries !== null &&
    (!Array.isArray(input.eligibleCountries) ||
      input.eligibleCountries.some((country) => !/^[A-Za-z]{2}$/.test(String(country).trim())))
  ) {
    throw new Error("eligibleCountries_invalid");
  }
  const eligibleCountries = optionalStringArray(input.eligibleCountries, "eligibleCountries", 50, 2)
    ?.map((country) => country.toUpperCase());
  if (eligibleCountries?.some((country) => !/^[A-Z]{2}$/.test(country))) {
    throw new Error("eligibleCountries_invalid");
  }

  const salaryCurrency = optionalString(input.salaryCurrency, 3)?.toUpperCase();
  if (salaryCurrency != null && !/^[A-Z]{3}$/.test(salaryCurrency)) {
    throw new Error("salaryCurrency_invalid");
  }
  const jobContentHash = optionalString(input.jobContentHash, 64)?.toLowerCase();
  if (jobContentHash != null && !/^[a-f0-9]{64}$/.test(jobContentHash)) {
    throw new Error("jobContentHash_invalid");
  }

  const result: StructuredApplicationMetadataInput = {
    workMode: optionalEnum(input.workMode, WORK_MODES, "workMode"),
    eligibleCountries,
    primaryLocations: optionalStringArray(input.primaryLocations, "primaryLocations", 50, 200),
    officeDaysMin: optionalInteger(input.officeDaysMin, "officeDaysMin", 0, 7),
    travelPercent: optionalInteger(input.travelPercent, "travelPercent", 0, 100),
    visaSponsorship: optionalBoolean(input.visaSponsorship),
    rightToWorkRequired: optionalBoolean(input.rightToWorkRequired),
    timezoneOverlap: optionalString(input.timezoneOverlap, 255),
    salaryCurrency,
    salaryPeriod: optionalEnum(input.salaryPeriod, SALARY_PERIODS, "salaryPeriod"),
    salaryType: optionalEnum(input.salaryType, SALARY_TYPES, "salaryType"),
    atsName: optionalString(input.atsName, 100),
    requisitionId: optionalString(input.requisitionId, 255),
    jobCapturedAt: optionalDate(input.jobCapturedAt, "jobCapturedAt"),
    jobVerifiedAt: optionalDate(input.jobVerifiedAt, "jobVerifiedAt"),
    jobPostedAt: optionalDate(input.jobPostedAt, "jobPostedAt"),
    jobClosedAt: optionalDate(input.jobClosedAt, "jobClosedAt"),
    jobContentHash,
    jobLiveness: optionalEnum(input.jobLiveness, JOB_LIVENESS, "jobLiveness"),
    jobSummary: optionalString(input.jobSummary, 10_000),
    currentStage: optionalString(input.currentStage, 255),
  };

  const rawJobUrl = input.jobUrl !== undefined ? input.jobUrl : input.canonicalJobUrl;
  if (rawJobUrl !== undefined) {
    if (rawJobUrl === null || rawJobUrl === "") {
      result.canonicalJobUrl = null;
    } else {
      const canonicalJobUrl = canonicalizeJobUrl(String(rawJobUrl));
      if (!canonicalJobUrl) throw new Error("jobUrl_invalid");
      result.canonicalJobUrl = canonicalJobUrl;
    }
  }

  return Object.fromEntries(
    Object.entries(result).filter(([, value]) => value !== undefined),
  ) as StructuredApplicationMetadataInput;
}
