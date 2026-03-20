import React from "react";
import { Document, Page, Text, View, Link, StyleSheet } from "@react-pdf/renderer";
import type {
  CvContact,
  CvSkillCategory,
  CvExperienceEntry,
  CvProject,
  CvEducation,
} from "@/lib/db/types";

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    paddingTop: 36,
    paddingBottom: 36,
    paddingHorizontal: 48,
    lineHeight: 1.4,
  },
  name: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
    marginBottom: 4,
  },
  contactRow: {
    flexDirection: "row",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 16,
    fontSize: 9,
    color: "#444",
  },
  contactItem: {
    flexDirection: "row",
  },
  contactSep: {
    marginHorizontal: 4,
    color: "#999",
  },
  sectionTitle: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    marginTop: 12,
    marginBottom: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: "#333",
    paddingBottom: 2,
  },
  profile: {
    marginBottom: 4,
  },
  skillRow: {
    flexDirection: "row",
    marginBottom: 2,
  },
  skillCategory: {
    fontFamily: "Helvetica-Bold",
    width: 130,
  },
  skillItems: {
    flex: 1,
  },
  entryHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
    marginBottom: 1,
  },
  entryCompany: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
  },
  entryDate: {
    fontSize: 9,
    color: "#555",
  },
  entrySubHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  entryTitle: {
    fontFamily: "Helvetica-Oblique",
    fontSize: 10,
  },
  entryLocation: {
    fontSize: 9,
    color: "#555",
  },
  bullet: {
    flexDirection: "row",
    marginLeft: 10,
    marginBottom: 1,
  },
  bulletDot: {
    width: 10,
    fontSize: 10,
  },
  bulletText: {
    flex: 1,
  },
  compactEntry: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 3,
    marginBottom: 1,
  },
  compactLeft: {
    fontFamily: "Helvetica-Oblique",
    fontSize: 9,
  },
  compactRight: {
    fontSize: 9,
    color: "#555",
  },
  projectName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
  },
  projectStack: {
    fontSize: 9,
    color: "#555",
    marginBottom: 1,
  },
  projectDesc: {
    marginBottom: 4,
  },
  projectHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
    marginBottom: 1,
  },
  link: {
    color: "#333",
    textDecoration: "none",
    fontSize: 9,
  },
  eduHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
    marginBottom: 1,
  },
  eduDegree: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
  },
  eduInstitution: {
    fontSize: 9,
    color: "#555",
  },
});

interface CvDocumentProps {
  name: string;
  contact: CvContact;
  profile: string;
  skills: CvSkillCategory[];
  experience: CvExperienceEntry[];
  projects: CvProject[];
  education: CvEducation[];
}

function ContactSection({ contact }: { contact: CvContact }) {
  const items: Array<{ text: string; href?: string }> = [];
  if (contact.email) items.push({ text: contact.email, href: `mailto:${contact.email}` });
  if (contact.phone) items.push({ text: contact.phone, href: `tel:${contact.phone}` });
  if (contact.linkedin) items.push({ text: contact.linkedin, href: `https://${contact.linkedin}` });
  if (contact.github) items.push({ text: contact.github, href: `https://${contact.github}` });
  if (contact.location) items.push({ text: contact.location });

  return (
    <View style={styles.contactRow}>
      {items.map((item, i) => (
        <View key={i} style={styles.contactItem}>
          {i > 0 && <Text style={styles.contactSep}>|</Text>}
          {item.href ? (
            <Link src={item.href} style={styles.link}>
              {item.text}
            </Link>
          ) : (
            <Text>{item.text}</Text>
          )}
        </View>
      ))}
    </View>
  );
}

function SkillsSection({ skills }: { skills: CvSkillCategory[] }) {
  if (skills.length === 0) return null;
  return (
    <View>
      <Text style={styles.sectionTitle}>Skills</Text>
      {skills.map((s, i) => (
        <View key={i} style={styles.skillRow}>
          <Text style={styles.skillCategory}>{s.category}</Text>
          <Text style={styles.skillItems}>{s.items.join(", ")}</Text>
        </View>
      ))}
    </View>
  );
}

function ExperienceSection({ entries }: { entries: CvExperienceEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <View>
      <Text style={styles.sectionTitle}>Experience</Text>
      {entries.map((e, i) => {
        if (e.tier === 3) {
          return (
            <View key={i} style={styles.compactEntry}>
              <Text style={styles.compactLeft}>
                {e.title}, {e.company}
              </Text>
              <Text style={styles.compactRight}>
                {e.date} | {e.location}
              </Text>
            </View>
          );
        }
        return (
          <View key={i}>
            <View style={styles.entryHeader}>
              <Text style={styles.entryCompany}>{e.company}</Text>
              <Text style={styles.entryDate}>{e.date}</Text>
            </View>
            <View style={styles.entrySubHeader}>
              <Text style={styles.entryTitle}>{e.title}</Text>
              <Text style={styles.entryLocation}>{e.location}</Text>
            </View>
            {e.bullets.map((b, j) => (
              <View key={j} style={styles.bullet}>
                <Text style={styles.bulletDot}>•</Text>
                <Text style={styles.bulletText}>{b}</Text>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

function ProjectsSection({ projects }: { projects: CvProject[] }) {
  if (projects.length === 0) return null;
  return (
    <View>
      <Text style={styles.sectionTitle}>Projects</Text>
      {projects.map((p, i) => (
        <View key={i}>
          <View style={styles.projectHeader}>
            <Text style={styles.projectName}>{p.name}</Text>
            {p.url && (
              <Link src={`https://${p.url}`} style={styles.link}>
                {p.url}
              </Link>
            )}
          </View>
          <Text style={styles.projectStack}>{p.stack}</Text>
          <Text style={styles.projectDesc}>{p.description}</Text>
        </View>
      ))}
    </View>
  );
}

function EducationSection({ education }: { education: CvEducation[] }) {
  if (education.length === 0) return null;
  return (
    <View>
      <Text style={styles.sectionTitle}>Education</Text>
      {education.map((e, i) => (
        <View key={i} style={styles.eduHeader}>
          <View>
            <Text style={styles.eduDegree}>{e.degree}</Text>
            <Text style={styles.eduInstitution}>{e.institution}</Text>
          </View>
          <View>
            <Text style={styles.entryDate}>{e.date}</Text>
            <Text style={styles.entryLocation}>{e.location}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export function CvDocument({
  name,
  contact,
  profile,
  skills,
  experience,
  projects,
  education,
}: CvDocumentProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.name}>{name}</Text>
        <ContactSection contact={contact} />
        {profile && (
          <View>
            <Text style={styles.sectionTitle}>Profile</Text>
            <Text style={styles.profile}>{profile}</Text>
          </View>
        )}
        <SkillsSection skills={skills} />
        <ExperienceSection entries={experience} />
        <ProjectsSection projects={projects} />
        <EducationSection education={education} />
      </Page>
    </Document>
  );
}
