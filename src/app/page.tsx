import { Nav, Hero } from '@/components/landing/hero';
import { Problem, HowItWorks, Categories } from '@/components/landing/sections';
import { ActionSection, DemoSection, Footer } from '@/components/landing/action-demo';
import { ScannerDemo } from '@/components/landing/scanner-demo';
import { ScoreboardSection } from '@/components/landing/scoreboard';

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <Nav />
      <main className="flex-1">
        <Hero />
        <Problem />
        <HowItWorks />
        <Categories />
        <ActionSection />
        <ScannerDemo />
        <ScoreboardSection />
        <DemoSection />
      </main>
      <Footer />
    </div>
  );
}
