export default function LoadingSentenceDetail() {
  return (
    <>
      <div className="flex items-center gap-3 border-b border-zinc-800 px-5 py-4">
        <div className="h-9 w-9 animate-pulse rounded-md bg-zinc-800" />
        <div className="space-y-2">
          <div className="h-6 w-56 animate-pulse rounded bg-zinc-800" />
          <div className="h-4 w-40 animate-pulse rounded bg-zinc-800" />
        </div>
      </div>
      <div className="grid gap-5 p-5 xl:grid-cols-[1fr_420px]">
        <section className="space-y-5">
          <div className="border border-zinc-800 bg-[#1d1e1c] p-5">
            <div className="mb-5 flex gap-3">
              <div className="h-7 w-28 animate-pulse rounded-md bg-zinc-800" />
              <div className="h-7 w-28 animate-pulse rounded-md bg-zinc-800" />
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {Array.from({ length: 10 }).map((_, index) => (
                <div key={index} className="space-y-2">
                  <div className="h-3 w-24 animate-pulse rounded bg-zinc-800" />
                  <div className="h-5 w-32 animate-pulse rounded bg-zinc-800" />
                </div>
              ))}
            </div>
          </div>
          <div className="border border-zinc-800 bg-[#1d1e1c] p-5">
            <div className="mb-4 h-6 w-36 animate-pulse rounded bg-zinc-800" />
            <div className="space-y-3">
              <div className="h-4 w-full animate-pulse rounded bg-zinc-800" />
              <div className="h-4 w-5/6 animate-pulse rounded bg-zinc-800" />
              <div className="h-4 w-2/3 animate-pulse rounded bg-zinc-800" />
            </div>
          </div>
        </section>
        <aside className="min-h-[360px] border border-zinc-800 bg-[#1d1e1c] p-5">
          <div className="mb-5 h-6 w-40 animate-pulse rounded bg-zinc-800" />
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="h-16 animate-pulse rounded bg-zinc-800" />
            ))}
          </div>
        </aside>
      </div>
    </>
  );
}
