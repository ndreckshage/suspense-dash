import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({
  src: "../public/geist-latin.woff2",
  variable: "--font-geist-sans",
});

const geistMono = localFont({
  src: "../public/geist-mono-latin.woff2",
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "Suspense Boundary Monitor - PDP Demo",
  description:
    "Instrumented mock ecommerce PDP with suspense boundary performance monitoring",
};

/**
 * Root layout — intentionally minimal.
 *
 * All instrumented suspense boundaries (Layout, Nav, Title, Footer) live in the
 * page component. This is because Next.js App Router renders layouts and pages
 * concurrently — a blocking await in the layout does NOT delay the page's
 * rendering. To correctly demonstrate the parent-blocks-children pattern, the
 * entire boundary hierarchy must live within a single rendering tree (the page).
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-zinc-950 text-zinc-100`}
      >
        {children}
      </body>
    </html>
  );
}
