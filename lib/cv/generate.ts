import React from "react";
import { randomUUID } from "crypto";
import { renderToBuffer } from "@react-pdf/renderer";
import { CvDocument } from "./pdf-template";
import { uploadFile, deleteFile, fileExists } from "@/lib/storage";
import type { DatabaseAdapter } from "@/lib/db/adapter";
import type { CvProfileRecord, CvPatchRecord, DocumentRecord } from "@/lib/db/types";

export interface MergedCvData {
  name: string;
  contact: CvProfileRecord["contact"];
  profile: string;
  skills: CvProfileRecord["skills"];
  experience: CvProfileRecord["experience"];
  projects: CvProfileRecord["projects"];
  education: CvProfileRecord["education"];
}

export interface MergeResult {
  data: MergedCvData;
  unmatchedExperienceIds: string[];
  unmatchedSkillCategories: string[];
}

export function mergeCvData(profile: CvProfileRecord, patch: CvPatchRecord): MergeResult {
  const experienceMap = new Map(profile.experience.map((e) => [e.id, e]));
  const experience = patch.experienceIds
    .map((id) => experienceMap.get(id))
    .filter((e): e is NonNullable<typeof e> => e != null);
  const unmatchedExperienceIds = patch.experienceIds.filter((id) => !experienceMap.has(id));

  const skillCategorySet = new Set(profile.skills.map((s) => s.category));
  const skills = patch.skillCategories
    .map((cat) => profile.skills.find((s) => s.category === cat))
    .filter((s): s is NonNullable<typeof s> => s != null);
  const unmatchedSkillCategories = patch.skillCategories.filter((cat) => !skillCategorySet.has(cat));

  return {
    data: {
      name: profile.name,
      contact: profile.contact,
      profile: patch.profileOverride ?? profile.profile,
      skills,
      experience,
      projects: patch.includeProjects ? profile.projects : [],
      education: patch.includeEducation ? profile.education : [],
    },
    unmatchedExperienceIds,
    unmatchedSkillCategories,
  };
}

export async function generateCvPdf(data: MergedCvData): Promise<Buffer> {
  const element = React.createElement(CvDocument, data);
  return renderToBuffer(element as React.ReactElement<never>);
}

/** Shared logic: render PDF, store as document, replace previous CV, update patch. */
export async function generateAndStoreCv(opts: {
  db: DatabaseAdapter;
  userId: string;
  applicationId: string;
  company: string;
  role: string;
  profile: CvProfileRecord;
  patch: CvPatchRecord;
}): Promise<{ doc: DocumentRecord; warnings: string[] }> {
  const { db, userId, applicationId, company, role, profile, patch } = opts;
  const warnings: string[] = [];

  const merged = mergeCvData(profile, patch);
  if (merged.unmatchedExperienceIds.length > 0) {
    warnings.push(`Unmatched experience IDs ignored: ${merged.unmatchedExperienceIds.join(", ")}`);
  }
  if (merged.unmatchedSkillCategories.length > 0) {
    warnings.push(`Unmatched skill categories ignored: ${merged.unmatchedSkillCategories.join(", ")}`);
  }

  const pdfBuffer = await generateCvPdf(merged.data);

  // Delete previous CV document if tracked on the patch
  if (patch.documentId) {
    const oldDoc = await db.getDocument(patch.documentId, userId);
    if (oldDoc) {
      if (await fileExists(oldDoc.filename)) {
        await deleteFile(oldDoc.filename);
      }
      await db.deleteDocument(oldDoc.id, userId);
    }
  }

  // Store new PDF
  const filename = `${randomUUID()}.pdf`;
  const originalName = `CV - ${company} - ${role}.pdf`;
  await uploadFile(filename, Buffer.from(pdfBuffer), "application/pdf");

  const doc = await db.createDocument(userId, {
    filename,
    originalName,
    size: pdfBuffer.length,
    mimeType: "application/pdf",
    applicationIds: [applicationId],
  });

  // Track document on patch
  await db.setCvPatchDocumentId(patch.id, doc.id);

  return { doc, warnings };
}
