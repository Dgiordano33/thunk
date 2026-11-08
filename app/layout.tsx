import type { Metadata } from "next";
import { Geist, Geist_Mono, Pixelify_Sans } from "next/font/google";
import { Providers } from "@/components/providers";
import { Retune } from "retune";
import "./globals.css";
import { themeScript } from "@/lib/theme";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Only used inside the `.world` home map and its HUD.
const pixel = Pixelify_Sans({ variable: "--font-pixel", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Thunk",
  description: "A canvas-style coding harness: responses are documents you edit, comment on, and send back.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} ${pixel.variable} h-full antialiased`}>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body className="h-full" suppressHydrationWarning>
        <Providers>{children}</Providers>
        {process.env.NODE_ENV === "development" && <Retune />}
      </body>
    </html>
  );
}
