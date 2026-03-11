import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Job Tracker",
  description: "Track your job applications",
};

// Inline script to apply theme and boss mode before first paint (prevents flash)
const themeScript = `(function(){try{var d=document.documentElement;var t=localStorage.getItem("theme")||"system";if(t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme:dark)").matches))d.classList.add("dark");var b=localStorage.getItem("bossMode")==="true";if(b){d.dataset.bossMode="on";document.title="Workspace"}}catch(e){}})()`;

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${geist.className} bg-gray-50 dark:bg-gray-900 min-h-screen transition-colors`}>
        <NextIntlClientProvider messages={messages} locale={locale}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
