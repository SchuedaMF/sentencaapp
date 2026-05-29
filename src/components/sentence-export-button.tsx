"use client";

import { useState } from "react";
import { AlertTriangle, Download, Loader2 } from "lucide-react";

type ExportStatus = "idle" | "loading" | "error";

const exportUrl = "/fila/export";
const fallbackFilename = "sentences-completa.xlsx";
const spreadsheetContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function SentenceExportButton() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ExportStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function openModal() {
    setErrorMessage(null);
    setStatus("idle");
    setOpen(true);
  }

  function closeModal() {
    if (status === "loading") return;
    setOpen(false);
    setErrorMessage(null);
    setStatus("idle");
  }

  async function confirmExport() {
    setStatus("loading");
    setErrorMessage(null);

    try {
      const response = await fetch(exportUrl, {
        cache: "no-store",
        credentials: "same-origin",
      });
      const contentType = response.headers.get("content-type") ?? "";

      if (response.redirected && response.url.includes("/login")) {
        window.location.assign(response.url);
        return;
      }

      if (!response.ok || !contentType.includes(spreadsheetContentType)) {
        throw new Error(await readErrorMessage(response));
      }

      const blob = await response.blob();
      const filename = parseFilename(response.headers.get("content-disposition")) ?? fallbackFilename;
      downloadBlob(blob, filename);
      setOpen(false);
      setStatus("idle");
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Nao foi possivel emitir o relatorio.");
    }
  }

  return (
    <>
      <button
        aria-haspopup="dialog"
        className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-700 px-3 text-sm font-semibold text-zinc-100 transition-colors hover:border-sky-500/60 hover:bg-sky-500/15 hover:text-sky-100"
        onClick={openModal}
        type="button"
      >
        <Download className="h-4 w-4" />
        Exportar
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div
            aria-labelledby="sentence-export-title"
            aria-modal="true"
            className="w-full max-w-md border border-zinc-800 bg-[#20211f] p-5 shadow-2xl"
            role="dialog"
          >
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-semibold text-zinc-50" id="sentence-export-title">
                  {"Exportar relat\u00f3rio"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-zinc-300">
                  {"Deseja emitir um relat\u00f3rio com todos os dados?"}
                </p>
              </div>

              {status === "loading" ? (
                <div className="flex items-center gap-3 border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-100">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Baixando planilha...
                </div>
              ) : null}

              {status === "error" && errorMessage ? (
                <div className="flex items-start gap-3 border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              ) : null}

              <div className="flex justify-end gap-2">
                <button
                  className="h-9 rounded-md border border-zinc-700 px-3 text-sm font-semibold text-zinc-200 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={status === "loading"}
                  onClick={closeModal}
                  type="button"
                >
                  {"N\u00e3o"}
                </button>
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-sky-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-sky-900 disabled:text-sky-100"
                  disabled={status === "loading"}
                  onClick={confirmExport}
                  type="button"
                >
                  {status === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  Sim
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

async function readErrorMessage(response: Response) {
  if (response.status === 403) return "Exportacao restrita a administradores, gestores e analistas.";

  const text = await response.text().catch(() => "");
  if (text.trim()) return text.trim();
  return "Nao foi possivel emitir o relatorio.";
}

function parseFilename(header: string | null) {
  if (!header) return null;

  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1].trim());

  const quotedMatch = header.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) return quotedMatch[1].trim();

  const plainMatch = header.match(/filename=([^;]+)/i);
  return plainMatch?.[1]?.trim() ?? null;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
