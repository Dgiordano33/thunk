import { cookies } from "next/headers";
import { listProjects } from "@/lib/db/repo/projects";
import { initialOnboarding, ONBOARDING_COOKIE } from "@/lib/onboarding";
import { isMobileRequest } from "@/components/mobile/viewport.server";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { DevTools } from "@/components/dev-tools";
import "./globals.css";
import { themeScript } from "@/lib/theme";
import { lookClass } from "@/lib/look";
import { getLook } from "@/lib/look.server";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const viewport: Viewport = { viewportFit: "cover", interactiveWidget: "resizes-content" };

export const metadata: Metadata = {
  title: "Thunk",
  description: "A canvas-style coding harness: responses are documents you edit, comment on, and send back.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const look = await getLook();
  const projects = await listProjects();
  const onboarding = initialOnboarding((await cookies()).get(ONBOARDING_COOKIE)?.value, projects.length > 0);
  const initialDesktop = !(await isMobileRequest());
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} ${lookClass(look)} h-full antialiased`}>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body className="h-full" suppressHydrationWarning>
        <Providers onboarding={onboarding} hasProjects={projects.length > 0} look={look} initialDesktop={initialDesktop}>{children}</Providers>
        <DevTools />
      </body>
    </html>
  );
}
