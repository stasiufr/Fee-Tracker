import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Pump.fun Fee Tracker | This is Fine",
  description:
    "Real-time transparency dashboard tracking creator fee flows across the pump.fun ecosystem. See who burns vs who extracts.",
  keywords: ["pump.fun", "solana", "meme coins", "creator fees", "burn tracker"],
  metadataBase: new URL("https://fees.alonisthe.dev"),
  openGraph: {
    title: "Pump.fun Fee Tracker",
    description: "Track creator fee burns in real-time. This is fine.",
    siteName: "Fee Tracker",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Pump.fun Fee Tracker",
    description: "Track creator fee burns in real-time. This is fine.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen bg-surface`}
      >
        <div className="min-h-screen flex flex-col">
          {/* Header */}
          <header className="border-b border-zinc-800 bg-surface-secondary/50 backdrop-blur-sm sticky top-0 z-50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex items-center justify-between h-16">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🔥</span>
                  <div>
                    <h1 className="text-lg font-bold text-gradient-fire">
                      PUMP.FUN FEE TRACKER
                    </h1>
                    <p className="text-xs text-zinc-500">
                      &quot;This is fine&quot; Edition
                    </p>
                  </div>
                </div>

                <nav className="hidden md:flex items-center gap-6">
                  <Link
                    href="/"
                    className="text-sm text-zinc-400 hover:text-white transition-colors"
                  >
                    Dashboard
                  </Link>
                  <Link
                    href="/leaderboard"
                    className="text-sm text-zinc-400 hover:text-white transition-colors"
                  >
                    Leaderboard
                  </Link>
                  <Link
                    href="/badges"
                    className="text-sm text-zinc-400 hover:text-white transition-colors"
                  >
                    Badges
                  </Link>
                </nav>

                {/* Search placeholder */}
                <div className="hidden sm:block">
                  <input
                    type="text"
                    placeholder="Search token..."
                    className="bg-surface-tertiary border border-zinc-700 rounded-lg px-4 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-fire-500 focus:border-transparent w-48"
                  />
                </div>
              </div>
            </div>
          </header>

          {/* Main content */}
          <main className="flex-1">{children}</main>

          {/* Footer */}
          <footer className="border-t border-zinc-800 bg-surface-secondary/30">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-sm text-zinc-500">
                  <span>🐕</span>
                  <span>
                    Built for CCM by{" "}
                    <a
                      href="https://alonisthe.dev"
                      className="text-fire-400 hover:text-fire-300 transition-colors"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      alonisthe.dev
                    </a>
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs text-zinc-600">
                  <span>Data from Helius</span>
                  <span>•</span>
                  <span>Updated in real-time</span>
                </div>
              </div>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
