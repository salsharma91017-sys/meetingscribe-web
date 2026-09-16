import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KoreVia MeetingScribe",
  description:
    "AI-powered meeting recording and reporting by KoreVia Solutions — record a meeting, then turn it into a structured report.",
  icons: {
    icon: "/icon.svg",
    apple: "/korevia-logo.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#05070d",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
