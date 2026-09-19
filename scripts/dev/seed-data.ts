import type { PrismaClient, Prisma } from "@prisma/client";
import { createDemoFixtures } from "../../lib/demo-workspace/fixtures";
import { assertLocalDevelopmentEnvironment } from "../../lib/auth/local-development";

type SignUp = (input: { name: string; email: string; password: string }) => Promise<{ user: { id: string } }>;
type VerifyPassword = (input: { hash: string; password: string }) => Promise<boolean>;

/** Editable fictional fixtures are isolated by the dedicated local database and seed accounts. */
export async function seedLocalData(db: PrismaClient, signUp: SignUp, env: NodeJS.ProcessEnv, verifyPassword: VerifyPassword) {
  assertLocalDevelopmentEnvironment(env);
  const fixtures = createDemoFixtures();
  const accounts: { email: string; isAdmin: boolean }[] = [];
  const plans: { role: "ADMIN" | "USER"; email: string; password: string; existing: { id: string } | null }[] = [];
  for (const role of ["ADMIN", "USER"] as const) {
    const email = env[`LOCAL_DEV_${role}_EMAIL`]?.trim().toLowerCase();
    const password = env[`LOCAL_DEV_${role}_PASSWORD`];
    if (!email || !password) throw new Error("Missing local seed account configuration");
    if (plans.some(plan => plan.email === email)) throw new Error("Local admin and regular users need different email addresses");
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      const credential = await db.account.findFirst({ where: { userId: existing.id, providerId: "credential" } });
      if (!credential?.password) throw new Error("A local seed account exists without password authentication. Use a fresh local profile.");
      if (!(await verifyPassword({ hash: credential.password, password }))) throw new Error(`The stored ${role.toLowerCase()} password does not match .env.local. Existing credentials were not changed.`);
    }
    plans.push({ role, email, password, existing });
  }
  for (const { role, email, password, existing } of plans) {
    const user = existing ?? (await signUp({ email, password, name: role === "ADMIN" ? "Local Admin" : "Local User" })).user;
    await db.user.update({ where: { id: user.id }, data: { isAdmin: role === "ADMIN", emailVerified: true } });
    for (const fixture of fixtures.applications) {
      const { demoKey, ...fields } = fixture;
      const canonicalJobUrl = `https://local-fixtures.invalid/${demoKey}`;
      const events = fixtures.events.filter(event => event.applicationDemoKey === demoKey);
      await db.application.upsert({
        where: { userId_canonicalJobUrl: { userId: user.id, canonicalJobUrl } },
        update: {},
        create: {
          ...fields, userId: user.id, canonicalJobUrl, source: "local-development", isDemo: false,
          jobSummary: "Fictional, editable local development record.", workMode: fields.remote ? "remote" : "hybrid",
          nextAction: fields.status === "inbound" ? "Review this fictional lead" : "Review the next step",
          eventVersion: events.length,
          events: { create: events.map(event => ({
            type: event.type, occurredAt: event.occurredAt,
            idempotencyKey: `local-seed:${event.demoKey}`, source: "local-development", actor: email,
            metadata: event.metadata as Prisma.InputJsonValue,
          })) },
        },
      });
    }
    accounts.push({ email, isAdmin: role === "ADMIN" });
  }
  return accounts;
}
