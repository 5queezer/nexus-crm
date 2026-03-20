import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { CvDocument } from "./pdf-template";
import type { CvProfileRecord, CvPatchRecord } from "@/lib/db/types";

export interface MergedCvData {
  name: string;
  contact: CvProfileRecord["contact"];
  profile: string;
  skills: CvProfileRecord["skills"];
  experience: CvProfileRecord["experience"];
  projects: CvProfileRecord["projects"];
  education: CvProfileRecord["education"];
}

export function mergeCvData(profile: CvProfileRecord, patch: CvPatchRecord): MergedCvData {
  const experienceMap = new Map(profile.experience.map((e) => [e.id, e]));
  const experience = patch.experienceIds
    .map((id) => experienceMap.get(id))
    .filter((e): e is NonNullable<typeof e> => e != null);

  const skills = patch.skillCategories
    .map((cat) => profile.skills.find((s) => s.category === cat))
    .filter((s): s is NonNullable<typeof s> => s != null);

  return {
    name: profile.name,
    contact: profile.contact,
    profile: patch.profileOverride ?? profile.profile,
    skills,
    experience,
    projects: patch.includeProjects ? profile.projects : [],
    education: patch.includeEducation ? profile.education : [],
  };
}

export async function generateCvPdf(data: MergedCvData): Promise<Buffer> {
  const element = React.createElement(CvDocument, data);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- @react-pdf/renderer types expect ReactElement<DocumentProps>
  return renderToBuffer(element as React.ReactElement<never>);
}
