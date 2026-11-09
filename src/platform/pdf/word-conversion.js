import {
  checkCancelled,
  PDF_LIMITS,
  yieldToBrowser,
} from "./pdf-operations.js";
import { inspectDocxArchive } from "./document-archive.js";

export async function readDocx(bytes, { signal } = {}) {
  inspectDocxArchive(bytes);
  checkCancelled(signal);
  const module = await import("mammoth/mammoth.browser.js");
  const mammoth = module.default || module;
  const result = await mammoth.convertToHtml(
    {
      arrayBuffer: bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ),
    },
    {
      includeEmbeddedStyleMap: false,
      externalFileAccess: false,
      ignoreEmptyParagraphs: false,
      styleMap: [
        "u => u",
        "strike => s",
        "p[style-name='Title'] => h1:fresh",
        "p[style-name='Subtitle'] => h2:fresh",
      ],
    },
  );
  checkCancelled(signal);
  if (result.messages.some((message) => message.type === "error"))
    throw new Error(
      "Some document content could not be read. Save a standard .docx copy with embedded PNG/JPG images and try again.",
    );
  const parsed = new DOMParser().parseFromString(result.value, "text/html");
  if (
    Array.from(parsed.querySelectorAll("img")).some(
      (image) =>
        !/^data:image\/(png|jpeg);base64,/i.test(
          image.getAttribute("src") || "",
        ),
    )
  )
    throw new Error(
      "This document contains an unsupported image. Replace it with an embedded PNG or JPG in Word, then convert again.",
    );
  function previewText(node) {
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType !== 1) return "";
    if (node.tagName === "BR") return "\n";
    const content = Array.from(node.childNodes).map(previewText).join("");
    if (["TD", "TH"].includes(node.tagName)) return `${content}\t`;
    return ["P", "LI", "TR", "H1", "H2", "H3", "H4", "H5", "H6"].includes(
      node.tagName,
    )
      ? `${content}\n`
      : content;
  }
  const text = previewText(parsed.body)
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (
    text.length > 2_000_000 ||
    parsed.body.querySelectorAll("*").length > 15000
  )
    throw new Error(
      "This Word document has too much content. Convert a smaller document.",
    );
  if (!text.trim() && !parsed.querySelector("img"))
    throw new Error(
      "No readable document content was found. Choose a standard .docx file.",
    );
  return {
    html: result.value,
    text,
    warnings: result.messages
      .filter((message) => message.type === "warning")
      .map((message) => message.message),
  };
}

function safeLink(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol)
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

// The HTML is never injected into the page. Convert a small allowlist into a
// PDF definition, so scripts, external images and document-supplied CSS cannot run.
export function docxHtmlToDefinition(
  html,
  { pageSize = "A4", fontSize = 11 } = {},
) {
  if (
    !["A4", "LETTER"].includes(pageSize) ||
    ![10, 11, 12, 14].includes(fontSize)
  )
    throw new Error("Choose valid document settings.");
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const width = (pageSize === "LETTER" ? 612 : 595.28) - 96;
  let nodeCount = 0;
  function inline(node, style = {}) {
    if (++nodeCount > 30000)
      throw new Error(
        "This document has too much formatting. Convert a smaller copy.",
      );
    if (node.nodeType === 3) return { text: node.nodeValue, ...style };
    if (node.nodeType !== 1) return null;
    const tag = node.tagName.toLowerCase();
    if (["script", "style", "iframe", "object", "embed", "img"].includes(tag))
      return null;
    if (tag === "br") return { text: "\n", ...style };
    const next = { ...style };
    if (["b", "strong"].includes(tag)) next.bold = true;
    if (["i", "em"].includes(tag)) next.italics = true;
    if (tag === "u") next.decoration = "underline";
    if (["s", "strike", "del"].includes(tag)) next.decoration = "lineThrough";
    if (tag === "sup") {
      next.sup = true;
      next.fontSize = fontSize * 0.75;
    }
    if (tag === "sub") {
      next.sub = true;
      next.fontSize = fontSize * 0.75;
    }
    if (tag === "a") {
      const link = safeLink(node.getAttribute("href"));
      if (link) {
        next.link = link;
        next.color = "#1d4ed8";
      }
    }
    return {
      text: Array.from(node.childNodes)
        .map((child) => inline(child, next))
        .filter(Boolean),
      ...next,
    };
  }
  function image(node) {
    const source = node.getAttribute("src") || "";
    if (
      !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(source) ||
      source.length > 34_000_000
    )
      throw new Error(
        "This document contains an unsupported or oversized image. Use embedded PNG/JPG images of 25 MB or less.",
      );
    return { image: source, fit: [width, 620], margin: [0, 8, 0, 8] };
  }
  function table(node) {
    const rows = Array.from(node.rows || []);
    if (!rows.length || rows.length > 2000)
      throw new Error("This table is too large to convert.");
    const grid = Array.from({ length: rows.length }, () => []);
    rows.forEach((row, rowIndex) => {
      let column = 0;
      for (const cell of row.cells) {
        while (grid[rowIndex][column]) column += 1;
        const colSpan = Math.max(
          1,
          Math.min(Number(cell.getAttribute("colspan")) || 1, 20),
        );
        const rowSpan = Math.max(
          1,
          Math.min(
            Number(cell.getAttribute("rowspan")) || 1,
            rows.length - rowIndex,
          ),
        );
        if (column + colSpan > 20)
          throw new Error(
            "Tables with more than 20 columns are not supported.",
          );
        const content = blocks(cell);
        grid[rowIndex][column] = {
          stack: content.length ? content : [{ text: "" }],
          ...(colSpan > 1 ? { colSpan } : {}),
          ...(rowSpan > 1 ? { rowSpan } : {}),
          bold: cell.tagName === "TH",
          margin: [3, 3, 3, 3],
        };
        for (let y = rowIndex; y < rowIndex + rowSpan; y += 1)
          for (let x = column; x < column + colSpan; x += 1)
            if (y !== rowIndex || x !== column) grid[y][x] = {};
        column += colSpan;
      }
    });
    const columns = Math.max(...grid.map((row) => row.length));
    for (const row of grid)
      for (let index = 0; index < columns; index += 1)
        if (!row[index]) row[index] = { text: "" };
    return {
      table: {
        headerRows: rows[0].querySelector("th") ? 1 : 0,
        widths: Array(columns).fill("*"),
        body: grid,
      },
      layout: "lightHorizontalLines",
      margin: [0, 6, 0, 10],
    };
  }
  function blocks(parent) {
    const result = [];
    for (const node of parent.childNodes) {
      if (node.nodeType === 3) {
        if (node.nodeValue.trim()) result.push({ text: node.nodeValue });
        continue;
      }
      if (node.nodeType !== 1) continue;
      const tag = node.tagName.toLowerCase();
      if (["script", "style", "iframe", "object", "embed"].includes(tag))
        continue;
      if (tag === "table") {
        result.push(table(node));
        continue;
      }
      if (["ul", "ol"].includes(tag)) {
        result.push({
          [tag]: Array.from(node.children)
            .filter((child) => child.tagName === "LI")
            .map((item) => ({ stack: blocks(item) })),
          margin: [0, 3, 0, 8],
        });
        continue;
      }
      if (tag === "img") {
        result.push(image(node));
        continue;
      }
      if (node.querySelector("table,ul,ol")) {
        result.push(...blocks(node));
        continue;
      }
      const runs = [inline(node)].filter(Boolean);
      const heading = /^h[1-6]$/.test(tag) ? Number(tag[1]) : null;
      if (runs.length)
        result.push({
          text: runs,
          ...(heading
            ? {
                fontSize: [26, 21, 17, 14, 12, 11][heading - 1],
                bold: true,
                margin: [0, 12, 0, 8],
                headlineLevel: heading,
              }
            : { margin: [0, 0, 0, 8] }),
        });
      for (const img of node.querySelectorAll("img")) result.push(image(img));
    }
    return result;
  }
  const content = blocks(parsed.body);
  if (!content.length)
    throw new Error("No supported document content could be converted.");
  return {
    pageSize,
    pageMargins: [48, 48, 48, 48],
    defaultStyle: { font: "Roboto", fontSize, lineHeight: 1.2 },
    content,
    info: { producer: "AgenticThat PDF Studio" },
    compress: true,
  };
}

let pdfMaker;
export async function wordToPdf(
  source,
  { pageSize = "A4", fontSize = 11, customFont, signal, onProgress } = {},
) {
  checkCancelled(signal);
  const [makerModule, fontsModule] = await Promise.all([
    import("pdfmake/build/pdfmake.min.js"),
    import("pdfmake/build/vfs_fonts.js"),
  ]);
  pdfMaker ||= makerModule.default || makerModule;
  const fonts = fontsModule.default || fontsModule;
  pdfMaker.addVirtualFileSystem(fonts);
  await yieldToBrowser(signal);
  onProgress?.("Laying out paragraphs, tables, and images…");
  const definition = docxHtmlToDefinition(source.html, { pageSize, fontSize });
  const module = await import("@pdf-lib/fontkit");
  const fontkit = module.default || module;
  let fontData;
  if (customFont) {
    fontData = customFont.bytes;
    let binary = "";
    for (let index = 0; index < fontData.length; index += 32768)
      binary += String.fromCharCode(...fontData.subarray(index, index + 32768));
    pdfMaker.addVirtualFileSystem({ "Custom.ttf": btoa(binary) });
    pdfMaker.addFonts({
      Custom: {
        normal: "Custom.ttf",
        bold: "Custom.ttf",
        italics: "Custom.ttf",
        bolditalics: "Custom.ttf",
      },
    });
    definition.defaultStyle.font = "Custom";
  } else
    fontData = Uint8Array.from(atob(fonts["Roboto-Regular.ttf"]), (character) =>
      character.charCodeAt(0),
    );
  let font;
  try {
    font = fontkit.create(fontData);
    if (!font.hasGlyphForCodePoint) throw new Error();
  } catch {
    throw new Error(
      "This font could not be read. Choose a valid TTF or OTF font.",
    );
  }
  for (const character of source.text.replace(
    /[\r\n\t\u200c\u200d\ufe0e\ufe0f]/g,
    "",
  ))
    if (!font.hasGlyphForCodePoint(character.codePointAt(0)))
      throw new Error(
        "Some characters need a different font. Add a custom TTF/OTF font that supports the document's language, then convert again.",
      );
  const bytes = new Uint8Array(
    await pdfMaker.createPdf(definition).getBuffer(),
  );
  checkCancelled(signal);
  if (bytes.length > PDF_LIMITS.archiveBytes)
    throw new Error(
      "The converted PDF exceeds 150 MB. Convert a smaller document.",
    );
  return bytes;
}

export function textItemsToLines(items) {
  const lines = [];
  for (const item of items) {
    if (typeof item.str !== "string" || !item.str.trim()) continue;
    const height = Math.max(
      1,
      Math.hypot(item.transform[2], item.transform[3]),
    );
    const y = item.transform[5];
    const x = item.transform[4];
    let line = lines.find(
      (entry) =>
        Math.abs(entry.y - y) <
        Math.max(2, Math.min(entry.height, height) * 0.3),
    );
    if (!line) {
      line = { y, height, runs: [] };
      lines.push(line);
    }
    line.runs.push({
      text: item.str,
      x,
      width: item.width || 0,
      height,
      dir: item.dir,
      fontName: item.fontName || "",
    });
  }
  lines.sort((a, b) => b.y - a.y);
  for (const line of lines) {
    const rtl =
      line.runs.filter((run) => run.dir === "rtl").length >
      line.runs.length / 2;
    line.runs.sort((a, b) => (rtl ? b.x - a.x : a.x - b.x));
    line.rtl = rtl;
    line.text = line.runs
      .map((run, index) => {
        const previous = line.runs[index - 1];
        const gap = previous && !rtl ? run.x - previous.x - previous.width : 0;
        return (
          (index && !/^\s/.test(run.text) && !/\s$/.test(previous.text)
            ? gap > heightFor(line) * 2
              ? "\t"
              : " "
            : "") + run.text
        );
      })
      .join("");
  }
  return lines;
}
function heightFor(line) {
  return Math.max(6, Math.min(72, line.height));
}

export async function pdfToWord(
  pdfDocument,
  indices,
  { keepPages = true, signal, onProgress } = {},
) {
  if (!indices.length || indices.length > 100)
    throw new Error("Convert between 1 and 100 pages at a time.");
  const library = await import("docx");
  const { Document, Packer, Paragraph, TextRun, SectionType, PageOrientation } =
    library;
  const sections = [];
  const unreadable = [];
  let characters = 0;
  for (let index = 0; index < indices.length; index += 1) {
    await yieldToBrowser(signal);
    const page = await pdfDocument.getPage(indices[index] + 1);
    try {
      const content = await page.getTextContent();
      const lines = textItemsToLines(content.items);
      if (!lines.length) unreadable.push(indices[index] + 1);
      characters += lines.reduce((sum, line) => sum + line.text.length, 0);
      if (characters > 2_000_000)
        throw new Error("This PDF contains too much text. Select fewer pages.");
      const children = lines.map(
        (line) =>
          new Paragraph({
            bidirectional: line.rtl,
            spacing: { after: 80, line: 260 },
            children: [
              new TextRun({
                text: line.text,
                font: "Arial",
                size: Math.round(heightFor(line) * 2),
                rightToLeft: line.rtl,
              }),
            ],
          }),
      );
      const viewport = page.getViewport?.({ scale: 1 }) || {
        width: page.view[2] - page.view[0],
        height: page.view[3] - page.view[1],
      };
      const width = Math.round(
        Math.max(144, Math.min(1584, viewport.width)) * 20,
      );
      const height = Math.round(
        Math.max(144, Math.min(1584, viewport.height)) * 20,
      );
      sections.push({
        properties: {
          type: SectionType.NEXT_PAGE,
          page: {
            size: {
              width: Math.min(width, height),
              height: Math.max(width, height),
              orientation:
                width > height
                  ? PageOrientation.LANDSCAPE
                  : PageOrientation.PORTRAIT,
            },
            margin: { top: 720, bottom: 720, left: 720, right: 720 },
          },
        },
        children,
      });
      onProgress?.(`Reading page ${index + 1} of ${indices.length}`);
    } finally {
      page.cleanup();
    }
  }
  if (unreadable.length)
    throw new Error(
      `Page${unreadable.length === 1 ? "" : "s"} ${unreadable.slice(0, 12).join(", ")}${unreadable.length > 12 ? "…" : ""} contain no selectable text. OCR is needed for scanned pages; choose text-based pages instead.`,
    );
  const document = new Document({
    creator: "AgenticThat PDF Studio",
    title: "Converted PDF",
    sections: keepPages
      ? sections
      : [
          {
            properties: {},
            children: sections.flatMap((section) => section.children),
          },
        ],
  });
  const blob = await Packer.toBlob(document);
  checkCancelled(signal);
  if (blob.size > PDF_LIMITS.archiveBytes)
    throw new Error("The Word document is too large. Select fewer pages.");
  return blob;
}
