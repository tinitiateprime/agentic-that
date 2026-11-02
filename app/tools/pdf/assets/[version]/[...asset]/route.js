import { readFile } from "node:fs/promises";
import path from "node:path";
import pdfjsPackage from "pdfjs-dist/package.json";

export const runtime = "nodejs";

// Only PDF.js runtime resources are public. Never accept arbitrary filesystem paths.
export async function GET(_request, { params }) {
  const { version, asset } = await params;
  if (version !== pdfjsPackage.version || asset?.length !== 2)
    return new Response("Not found", { status: 404 });
  const [directory, file] = asset;
  const allowed = {
    build: /^(pdf\.worker\.min\.mjs)$/,
    cmaps: /^[\w-]+\.bcmap$/,
    standard_fonts: /^[\w-]+\.(pfb|ttf)$/,
    wasm: /^[\w.-]+\.(wasm|js)$/,
    iccs: /^[\w.-]+\.icc$/,
  };
  if (!Object.hasOwn(allowed, directory) || !allowed[directory].test(file))
    return new Response("Not found", { status: 404 });
  try {
    const bytes = await readFile(
      path.join(process.cwd(), "node_modules", "pdfjs-dist", directory, file),
    );
    const type = /\.(mjs|js)$/.test(file)
      ? "text/javascript; charset=utf-8"
      : file.endsWith(".wasm")
        ? "application/wasm"
        : "application/octet-stream";
    return new Response(bytes, {
      headers: {
        "Content-Type": type,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
