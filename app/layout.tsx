import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LP Signal",
  description:
    "Daily LP allocation signals from North American pension board minutes.",
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full antialiased">{children}</body>
    </html>
  );
}
