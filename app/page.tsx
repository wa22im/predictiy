export default function Home() {
  return (
    <div className="flex flex-col min-h-screen">
      <main className="planner-bg flex-1 flex flex-col items-center justify-center">
        <div className="glass-panel p-8 md:p-12 max-w-xl mx-4 text-center">
          <h1 className="font-display text-5xl md:text-6xl lg:text-7xl tracking-tight">predicty</h1>
          <p className="mt-4 text-lg text-muted-foreground leading-7">
            Predict the game. Own the pool. Create private leagues, compete with friends, and prove you know the game.
          </p>
          <a
            href="/login"
            className="command-strip inline-flex items-center justify-center px-8 py-3 mt-8 text-base font-bold"
          >
            Get Started
          </a>
        </div>
      </main>
    </div>
  );
}
