import { COMPANY_SIZE_OPTIONS, INCOMING_SOURCE_OPTIONS } from "@/types";

const VALID_COMPANY_SIZES = COMPANY_SIZE_OPTIONS.map((o) => o.value) as string[];
const VALID_INCOMING_SOURCES = INCOMING_SOURCE_OPTIONS as readonly string[];

export function sanitizeTriageFields(item: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  if (item.companySize !== undefined) {
    result.companySize = item.companySize && VALID_COMPANY_SIZES.includes(String(item.companySize)) ? String(item.companySize) : null;
  }
  if (item.salaryBandMentioned !== undefined) {
    result.salaryBandMentioned = item.salaryBandMentioned === true || item.salaryBandMentioned === "true";
  }
  if (item.triageQuality !== undefined) {
    if (item.triageQuality == null) { result.triageQuality = null; }
    else {
      const parsed = parseInt(String(item.triageQuality), 10);
      result.triageQuality = Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ? parsed : null;
    }
  }
  if (item.triageReason !== undefined) {
    result.triageReason = item.triageReason ? String(item.triageReason).slice(0, 1000) : null;
  }
  if (item.incomingSource !== undefined) {
    result.incomingSource = item.incomingSource && VALID_INCOMING_SOURCES.includes(String(item.incomingSource)) ? String(item.incomingSource) : null;
  }
  if (item.autoRejected !== undefined) {
    result.autoRejected = item.autoRejected === true || item.autoRejected === "true";
  }
  if (item.autoRejectReason !== undefined) {
    result.autoRejectReason = item.autoRejectReason ? String(item.autoRejectReason).slice(0, 1000) : null;
  }
  return result;
}
