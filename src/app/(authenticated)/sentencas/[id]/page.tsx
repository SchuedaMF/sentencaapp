import { SentenceDetailView } from "@/components/sentence-detail";

export const unstable_instant = {
  prefetch: "runtime",
  unstable_disableValidation: true,
  samples: [
    { params: { id: "00000000-0000-0000-0000-000000000000" }, searchParams: { from: null } },
  ],
};

export default async function SentenceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const [{ id }, rawSearchParams] = await Promise.all([params, searchParams]);
  const backHref = safeInternalReturnHref(rawSearchParams.from) ?? "/fila?stage=QUALIDADE&status=EM+ANDAMENTO";

  return <SentenceDetailView backHref={backHref} sentenceId={id} variant="page" />;
}

function safeInternalReturnHref(value: string | string[] | undefined) {
  const href = Array.isArray(value) ? value[0] : value;
  if (!href) return null;

  if (href === "/fila" || href.startsWith("/fila?")) return href;
  if (href === "/importacao" || href.startsWith("/importacao?")) return href;
  return null;
}
