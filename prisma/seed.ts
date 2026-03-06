import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Find the first user to assign seeded data to
  const user = await prisma.user.findFirst();
  if (!user) {
    console.error("No users found. Log in first, then re-run the seed.");
    return;
  }

  // Clear existing data
  await prisma.application.deleteMany();

  const applications = [
    {
      company: "Amazon Ring",
      role: "SDE",
      status: "waiting",
      appliedAt: new Date("2026-02-10"),
      lastContact: null,
      notes: "Matt Brown (Recruiter); HackerRank offen",
    },
    {
      company: "Zurich/NTT",
      role: "Fullstack SE Alpha I",
      status: "ghost",
      appliedAt: new Date("2026-02-25"),
      lastContact: null,
      notes: "Franco Mahl; 240€/Tag; kein Feedback",
    },
    {
      company: "Aircall",
      role: "Senior Engineer",
      status: "ghost",
      appliedAt: new Date("2026-02-26"),
      lastContact: null,
      notes: "Guillaume Moulin; kein Feedback",
    },
    {
      company: "Deloitte",
      role: "Backend Engineer",
      status: "waiting",
      appliedAt: null,
      lastContact: null,
      notes: "Carolina Rico Quinn; CV vorbereitet",
    },
    {
      company: "KNAPP AG",
      role: "Java Senior",
      status: "draft",
      appliedAt: null,
      lastContact: null,
      notes: "Noch nicht abgeschickt",
    },
    {
      company: "Ringier AG",
      role: "Platform Engineer",
      status: "draft",
      appliedAt: null,
      lastContact: null,
      notes: "Noch nicht abgeschickt",
    },
  ];

  for (const app of applications) {
    await prisma.application.create({ data: { ...app, userId: user.id } });
  }

  console.log(`Seeded ${applications.length} applications.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
