import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Permitline — Florida Permit Leads",
  description: "Find, review and organize recent Florida permit opportunities in your private workspace.",
  robots: { index: false, follow: false },
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
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
