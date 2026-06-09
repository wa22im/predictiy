import { PitchBg, ScoreBug } from "@/components/football";

export default function Home() {
  return (
    <PitchBg
      variant="hero"
      className="flex min-h-screen flex-1 flex-col"
    >
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-16">
        <div className="w-full max-w-3xl text-center">
          <p className="micro-tag mb-6">Season live · Week 3</p>

          <ScoreBug
            home="PREDICTY"
            away="THE POOL"
            homeScore={null}
            awayScore={null}
            status="scheduled"
            kickoffAt={new Date(Date.now() + 1000 * 60 * 60 * 24)}
            className="mx-auto mb-10 max-w-xl"
          />

          <h1 className="heading-display text-5xl md:text-7xl lg:text-8xl text-foreground">
            Predict the game.
            <br />
            Own the pool.
          </h1>
          <p className="mt-6 text-lg text-muted-foreground leading-7 max-w-xl mx-auto">
            Create private leagues, compete with friends, and prove you know
            the game.
          </p>
          <a
            href="/signup"
            className="neon-button inline-flex items-center justify-center px-10 py-4 mt-10 text-base font-bold"
          >
            Get Started
          </a>
        </div>
      </main>
    </PitchBg>
  );
}
