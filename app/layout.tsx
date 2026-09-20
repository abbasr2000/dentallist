import type { Metadata } from "next";
import { Bricolage_Grotesque, Public_Sans, IBM_Plex_Mono } from "next/font/google";
import { SITE, SITE_URL, paths } from "@/lib/site";
import "./globals.css";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display-loaded",
  display: "swap",
});
const body = Public_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body-loaded",
  display: "swap",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono-loaded",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE.name} — ${SITE.tagline}`,
    template: `%s | ${SITE.name}`,
  },
  description: SITE.description,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-CA" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <SiteHeader />
        <main>{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}

function SiteHeader() {
  return (
    <header style={{ borderBottom: "1px solid var(--color-rule)", background: "var(--color-surface)" }}>
      <div
        className="wrap"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 20,
          paddingBlock: 16,
          flexWrap: "wrap",
        }}
      >
        <a href={paths.home()} style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "1.05rem", letterSpacing: "-0.02em" }}>
          {SITE.name}
        </a>
        <nav style={{ display: "flex", gap: 20, fontSize: 14.5, flexWrap: "wrap" }}>
          <a href={paths.region()} className="inline-link">Browse Ontario</a>
          <a href={paths.methodology()} className="inline-link">How we rank</a>
          <a href={paths.sources()} className="inline-link">Data sources</a>
          <a href={paths.addClinic()} className="inline-link">Add a clinic</a>
        </nav>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer
      style={{
        borderTop: "1px solid var(--color-rule)",
        marginTop: 64,
        paddingBlock: 32,
        background: "var(--color-surface)",
      }}
    >
      <div className="wrap" style={{ display: "grid", gap: 14 }}>
        <p style={{ fontSize: 14, color: "var(--color-ink-soft)", maxWidth: "68ch", margin: 0 }}>
          {SITE.name} lists dental practices across Ontario. Listings are compiled
          from the Royal College of Dental Surgeons of Ontario public register,
          OpenStreetMap, and clinics&rsquo; own published information. We do not
          publish patient testimonials or rank clinics by opinion.
        </p>
        <p style={{ fontSize: 13, color: "var(--color-ink-faint)", margin: 0 }}>
          Always confirm services, hours and fees with the clinic directly before
          attending. Nothing here is a recommendation or an endorsement.
        </p>
        <nav style={{ display: "flex", gap: 18, fontSize: 13.5, flexWrap: "wrap", marginTop: 4 }}>
          <a href={paths.methodology()} className="inline-link">How we rank</a>
          <a href={paths.sources()} className="inline-link">Data sources</a>
          <a href="/llms.txt" className="inline-link">llms.txt</a>
        </nav>
      </div>
    </footer>
  );
}
