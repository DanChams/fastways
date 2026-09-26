import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FASTWAY — Post Studio",
  description: "Calendrier de publication et validation des créations.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body className="antialiased">{children}</body>
    </html>
  );
}
