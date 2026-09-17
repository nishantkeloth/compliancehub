import "server-only";
import path from "path";

// Phase 12 follow-up — "read text only" fallback for the crew-intake
// "Read scanned documents as images" checkbox (see intake-panel.tsx /
// intake-actions.ts). Runs Tesseract OCR in-process on a rasterized page
// or image, so a scanned document can still be extracted with any
// text-only AI model — no vision-capable model, and no external OCR API,
// required at all.
//
// This matters because every vision-capable model configured for a
// company can be unavailable at the same time — rate-limited,
// mis-configured, or rejected as "too complex" by the provider all
// happened within the same afternoon of testing — while text-only models
// (which don't need this checkbox at all) are cheaper, more available,
// and completely unaffected by any of that.
//
// The English language pack (@tesseract.js-data/eng) is a normal npm
// dependency bundled at build/deploy time, and tesseract.js-core ships
// its own WASM binary the same way — so recognition never needs network
// access at request time. Without pointing langPath at the bundled copy,
// tesseract.js's default behaviour is to fetch language data from a CDN
// on first use, which is slow on a cold serverless start and one more
// external dependency to fail.

const MAX_OCR_PAGES = 5;

let cachedEngLangPath: string | null = null;
function engLangPath(): string {
  if (!cachedEngLangPath) {
    const pkgJson = require.resolve("@tesseract.js-data/eng/package.json");
    cachedEngLangPath = path.join(path.dirname(pkgJson), "4.0.0_best_int");
  }
  return cachedEngLangPath;
}

export async function ocrText(image: Buffer | Uint8Array): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    langPath: engLangPath(),
    // /tmp is the one writable path in a serverless function; caching the
    // decompressed traineddata there avoids re-decompressing our bundled
    // copy on every call within the same warm instance.
    cachePath: "/tmp",
    gzip: true,
  });
  try {
    const { data } = await worker.recognize(Buffer.isBuffer(image) ? image : Buffer.from(image));
    return (data.text ?? "").trim();
  } finally {
    await worker.terminate();
  }
}

// Rasterizes up to MAX_OCR_PAGES of a scanned PDF (same unpdf +
// @napi-rs/canvas pipeline already used for photo auto-crop — see
// app/crew/profiles/intake-actions.ts) and OCRs each page, joining the
// results. Capped so a long, fully-scanned document can't run the
// serverless function past its time limit.
export async function ocrPdfPages(pdfBytes: Uint8Array, numPages: number): Promise<string> {
  const { renderPageAsImage } = await import("unpdf");
  const pageCount = Math.max(0, Math.min(numPages, MAX_OCR_PAGES));
  const parts: string[] = [];
  for (let page = 1; page <= pageCount; page++) {
    const png = await renderPageAsImage(pdfBytes.slice(), page, { canvasImport: () => import("@napi-rs/canvas"), width: 1600 });
    const text = await ocrText(Buffer.from(png));
    if (text) parts.push(pageCount > 1 ? `## Page ${page}\n${text}` : text);
  }
  if (numPages > MAX_OCR_PAGES) parts.push(`[... ${numPages - MAX_OCR_PAGES} more page(s) not OCR'd ...]`);
  return parts.join("\n\n");
}
