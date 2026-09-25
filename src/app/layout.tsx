import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ShipScore — Lighthouse for the AI era",
  description:
    "An open-source agent that audits any repo shipping AI features — scores it 0-100 across Design, Ship, Run, Secure, Test — and opens real fix PRs.",
  keywords: ["ShipScore", "AI agents", "evals", "prompt injection", "CI", "GitHub Action", "developer tools", "WeAreDevelopers Hackathon"],
  authors: [{ name: "Team Dash" }],
  openGraph: {
    title: "ShipScore — Lighthouse for the AI era",
    description: "Score any AI-shipping repo 0-100 across Design, Ship, Run, Secure, Test — and open fix PRs automatically.",
    siteName: "ShipScore",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ShipScore — Lighthouse for the AI era",
    description: "Score any AI-shipping repo 0-100 across Design, Ship, Run, Secure, Test — and open fix PRs automatically.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
