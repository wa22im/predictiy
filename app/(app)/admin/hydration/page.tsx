import { HydrationForm } from "@/components/admin/HydrationForm";
import { PitchBg } from "@/components/football";

export default function HydrationPage() {
  return (
    <PitchBg variant="canvas">
      <main className="min-h-screen flex-1 flex flex-col items-center px-4 py-12">
        <div className="max-w-3xl w-full">
          <p className="micro-tag mb-3">Data Hydration</p>
          <h1 className="font-display text-4xl md:text-5xl tracking-tight mb-4">
            Hydration Terminal
          </h1>
          <p className="text-muted-foreground leading-7 mb-8">
            Paste a competition JSON payload or upload a file. Existing matches
            and markets will be updated in place — no duplicates, no deletions.
          </p>

          <HydrationForm />
        </div>
      </main>
    </PitchBg>
  );
}
