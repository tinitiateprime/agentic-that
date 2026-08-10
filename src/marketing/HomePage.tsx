import Capabilities from "./sections/Capabilities.tsx";
import ClosingCta from "./sections/ClosingCta.tsx";
import DataPreview from "./sections/DataPreview.tsx";
import EcosystemBar from "./sections/EcosystemBar.tsx";
import Hero from "./sections/Hero.tsx";
import Navbar from "./sections/Navbar.tsx";
import Pipeline from "./sections/Pipeline.tsx";
import SiteFooter from "./sections/SiteFooter.tsx";

/**
 * AgenticThat marketing homepage.
 *
 * Composed of self-contained section components — each one owns its own
 * `"use client"` boundary, so this shell stays a server component.
 */
export function HomePage() {
  return (
    <div
      data-surface="marketing"
      className="min-h-screen bg-[#0B0F17] font-sans text-slate-100 antialiased selection:bg-indigo-500/30 selection:text-white"
    >
      <Navbar />
      <main>
        <Hero />
        <EcosystemBar />
        <Capabilities />
        <Pipeline />
        <DataPreview />
        <ClosingCta />
      </main>
      <SiteFooter />
    </div>
  );
}

export default HomePage;
