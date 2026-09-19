import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@/lib/prisma";
import { isLocalDevelopmentAuthEnabled } from "@/lib/auth/local-development";

const baseURL = process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_BETTER_AUTH_URL || "http://localhost:3001";
const localDevelopmentAuthEnabled = isLocalDevelopmentAuthEnabled();
const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export const auth = betterAuth({
  baseURL,

  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: localDevelopmentAuthEnabled,
    autoSignIn: false,
  },
  socialProviders: googleConfigured || !localDevelopmentAuthEnabled
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        },
      }
    : {},
  trustedOrigins: [baseURL],
});
