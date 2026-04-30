import { StageSentenceListSkeleton } from "@/components/stage-sentence-list";

export default function Loading() {
  return (
    <>
      <div className="border-b border-zinc-800 px-5 py-4">
        <h1 className="text-xl font-semibold">Qualidade</h1>
      </div>
      <StageSentenceListSkeleton />
    </>
  );
}
