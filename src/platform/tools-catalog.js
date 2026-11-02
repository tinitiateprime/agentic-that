// Stable tool IDs are shared by navigation, the studio, and tool routes.
export const TOOL_STUDIOS = Object.freeze([
  {
    id: "pdf",
    name: "PDF Studio",
    description: "Every document task, in one place.",
  },
  {
    id: "image",
    name: "Image Studio",
    description: "A new space for your images.",
  },
  {
    id: "video",
    name: "Video Studio",
    description: "A new space for your videos.",
  },
]);

const groups = [
  {
    id: "essentials",
    name: "Everyday essentials",
    tools: [
      [
        "compress-pdf",
        "Compress PDF",
        "Make large documents easier to store and share.",
      ],
      [
        "convert-pdf",
        "Convert PDF",
        "Change documents to and from PDF formats.",
      ],
      [
        "merge-pdf",
        "Merge PDF",
        "Bring several PDF documents into a single file.",
      ],
      [
        "edit-pdf",
        "Edit & annotate PDF",
        "Add text, images, highlights, shapes, and comments.",
      ],
    ],
  },
  {
    id: "organize",
    name: "Organize pages",
    tools: [
      ["split-pdf", "Split PDF", "Separate a document into smaller PDF files."],
      [
        "organize-pdf",
        "Organize PDF",
        "Reorder, rotate, duplicate, remove, and insert pages.",
      ],
      ["rotate-pdf", "Rotate PDF", "Change the orientation of selected pages."],
      ["delete-pages", "Delete pages", "Remove pages from a document."],
      [
        "extract-pages",
        "Extract pages",
        "Save selected pages as a separate PDF.",
      ],
      [
        "insert-pages",
        "Insert pages",
        "Add new pages to an existing document.",
      ],
      [
        "duplicate-pages",
        "Duplicate pages",
        "Make additional copies of selected pages.",
      ],
      ["crop-pdf", "Crop PDF", "Trim page margins and unwanted edges."],
      [
        "resize-pages",
        "Resize pages",
        "Change the page dimensions of a document.",
      ],
      [
        "create-booklet",
        "Create booklet",
        "Arrange document pages for booklet printing.",
      ],
      [
        "pages-per-sheet",
        "Pages per sheet",
        "Place multiple document pages on one sheet.",
      ],
      [
        "split-double-pages",
        "Split double pages",
        "Separate scanned spreads into individual pages.",
      ],
    ],
  },
  {
    id: "to-pdf",
    name: "Convert to PDF",
    tools: [
      ["word-to-pdf", "Word to PDF", "Turn Word documents into PDF files."],
      [
        "excel-to-pdf",
        "Excel to PDF",
        "Turn spreadsheet content into PDF pages.",
      ],
      [
        "powerpoint-to-pdf",
        "PowerPoint to PDF",
        "Save presentation slides as a PDF.",
      ],
      [
        "images-to-pdf",
        "Images to PDF",
        "Combine JPG, PNG, and WebP images into a PDF.",
      ],
      ["jpg-to-pdf", "JPG to PDF", "Turn JPG images into PDF pages."],
      ["png-to-pdf", "PNG to PDF", "Turn PNG images into PDF pages."],
      ["webp-to-pdf", "WebP to PDF", "Turn WebP images into PDF pages."],
      ["heic-to-pdf", "HEIC to PDF", "Turn HEIC photos into PDF pages."],
      ["svg-to-pdf", "SVG to PDF", "Turn SVG artwork into a PDF document."],
      ["tiff-to-pdf", "TIFF to PDF", "Turn TIFF scans into a PDF document."],
      [
        "html-to-pdf",
        "HTML to PDF",
        "Save HTML content or a webpage as a PDF.",
      ],
      ["text-to-pdf", "Text to PDF", "Create a PDF document from plain text."],
      ["rtf-to-pdf", "RTF to PDF", "Turn rich text documents into PDF files."],
      ["epub-to-pdf", "EPUB to PDF", "Turn an EPUB ebook into a PDF document."],
      [
        "markdown-to-pdf",
        "Markdown to PDF",
        "Create a formatted PDF from Markdown.",
      ],
      [
        "opendocument-to-pdf",
        "OpenDocument to PDF",
        "Turn ODT, ODS, and ODP files into PDFs.",
      ],
    ],
  },
  {
    id: "from-pdf",
    name: "Convert from PDF",
    tools: [
      [
        "pdf-to-word",
        "PDF to Word",
        "Turn a PDF into an editable Word document.",
      ],
      ["pdf-to-excel", "PDF to Excel", "Move PDF tables into a spreadsheet."],
      [
        "pdf-to-powerpoint",
        "PDF to PowerPoint",
        "Turn PDF pages into presentation slides.",
      ],
      ["pdf-to-images", "PDF to images", "Export PDF pages as image files."],
      ["pdf-to-jpg", "PDF to JPG", "Save PDF pages as JPG images."],
      ["pdf-to-png", "PDF to PNG", "Save PDF pages as PNG images."],
      ["pdf-to-svg", "PDF to SVG", "Export PDF page content in SVG format."],
      ["pdf-to-tiff", "PDF to TIFF", "Save PDF pages as TIFF images."],
      [
        "pdf-to-text",
        "PDF to text",
        "Extract document text into a plain text file.",
      ],
      ["pdf-to-rtf", "PDF to RTF", "Export PDF content as rich text."],
      ["pdf-to-epub", "PDF to EPUB", "Turn a PDF document into an EPUB ebook."],
      ["pdf-to-html", "PDF to HTML", "Export PDF content for the web."],
      [
        "pdf-to-markdown",
        "PDF to Markdown",
        "Turn document content into Markdown.",
      ],
      [
        "pdf-to-pdfa",
        "PDF to PDF/A",
        "Prepare a document for long-term archiving.",
      ],
      [
        "pdf-to-opendocument",
        "PDF to OpenDocument",
        "Export PDF content to OpenDocument formats.",
      ],
    ],
  },
  {
    id: "edit",
    name: "Edit & annotate",
    tools: [
      [
        "annotate-pdf",
        "Annotate PDF",
        "Add comments, highlights, and notes to pages.",
      ],
      [
        "watermark-pdf",
        "Watermark PDF",
        "Add a text or image watermark to a document.",
      ],
      ["page-numbers", "Add page numbers", "Number the pages of a document."],
      [
        "headers-footers",
        "Headers & footers",
        "Add repeating information to document pages.",
      ],
      [
        "bookmarks",
        "Manage bookmarks",
        "Create and organize document navigation.",
      ],
      [
        "edit-metadata",
        "Edit PDF metadata",
        "Update document titles, authors, and properties.",
      ],
      ["overlay-pdf", "Overlay PDF", "Layer one PDF document over another."],
      [
        "extract-images",
        "Extract images",
        "Save the images contained in a PDF.",
      ],
    ],
  },
  {
    id: "optimize",
    name: "Optimize & repair",
    tools: [
      ["ocr-pdf", "OCR PDF", "Recognize text in scanned documents."],
      [
        "repair-pdf",
        "Repair PDF",
        "Recover readable content from a damaged PDF.",
      ],
      [
        "flatten-pdf",
        "Flatten PDF",
        "Combine annotations and form fields with page content.",
      ],
      [
        "rasterize-pdf",
        "Rasterize PDF",
        "Turn page content into image-based PDF pages.",
      ],
      [
        "grayscale-pdf",
        "PDF to grayscale",
        "Convert document colors to shades of gray.",
      ],
      [
        "web-optimize-pdf",
        "Optimize for web",
        "Prepare a PDF for efficient viewing online.",
      ],
    ],
  },
  {
    id: "security",
    name: "Sign & protect",
    tools: [
      ["sign-pdf", "Sign PDF", "Add your signature to a document."],
      [
        "request-signatures",
        "Request signatures",
        "Prepare documents for other people to sign.",
      ],
      ["protect-pdf", "Protect PDF", "Add password protection to a document."],
      [
        "unlock-pdf",
        "Unlock PDF",
        "Remove password protection with the required permission.",
      ],
      [
        "redact-pdf",
        "Redact PDF",
        "Remove sensitive text and images from a document.",
      ],
      [
        "remove-metadata",
        "Remove metadata",
        "Clear identifying properties from a PDF.",
      ],
      [
        "verify-signatures",
        "Verify signatures",
        "Inspect a document's digital signatures.",
      ],
    ],
  },
  {
    id: "forms",
    name: "Create, scan & forms",
    tools: [
      ["create-pdf", "Create PDF", "Start a new PDF document."],
      ["scan-to-pdf", "Scan to PDF", "Collect document scans into a PDF."],
      ["fill-pdf", "Fill PDF forms", "Complete the fields in a PDF form."],
      [
        "create-pdf-form",
        "Create PDF forms",
        "Build a document with interactive form fields.",
      ],
      [
        "make-pdf-fillable",
        "Make PDF fillable",
        "Add fillable fields to an existing document.",
      ],
    ],
  },
  {
    id: "review",
    name: "Read & understand",
    tools: [
      ["view-pdf", "View PDF", "Read a PDF document in the browser."],
      [
        "compare-pdf",
        "Compare PDFs",
        "Review differences between two document versions.",
      ],
      ["search-pdf", "Search PDFs", "Find words and phrases across documents."],
      [
        "check-pdfa",
        "Validate PDF/A",
        "Check a document's archival format compliance.",
      ],
      [
        "summarize-pdf",
        "Summarize PDF",
        "Get a shorter overview of a document's contents.",
      ],
      [
        "translate-pdf",
        "Translate PDF",
        "Read document content in another language.",
      ],
      [
        "chat-with-pdf",
        "Chat with PDF",
        "Ask questions about a document's contents.",
      ],
    ],
  },
];

export const PDF_READY_IDS = Object.freeze([
  "merge-pdf",
  "split-pdf",
  "organize-pdf",
  "images-to-pdf",
  "pdf-to-images",
  "compress-pdf",
  "pdf-to-word",
  "word-to-pdf",
  "edit-pdf",
]);
export const PDF_PLANNED_IDS = Object.freeze([
  "sign-pdf",
  "fill-pdf",
  "ocr-pdf",
]);
export const PDF_TOOL_ALIASES = Object.freeze({
  "jpg-to-pdf": "images-to-pdf",
  "png-to-pdf": "images-to-pdf",
  "webp-to-pdf": "images-to-pdf",
  "pdf-to-jpg": "pdf-to-images",
  "pdf-to-png": "pdf-to-images",
  "rotate-pdf": "organize-pdf",
  "delete-pages": "organize-pdf",
  "extract-pages": "split-pdf",
  "insert-pages": "organize-pdf",
  "duplicate-pages": "organize-pdf",
});
const allEntries = groups.flatMap((group) => group.tools);
const prioritized = new Set([...PDF_READY_IDS, ...PDF_PLANNED_IDS]);
const studioGroups = [
  {
    id: "available",
    name: "Ready to use",
    tools: PDF_READY_IDS.map((id) => allEntries.find((tool) => tool[0] === id)),
  },
  {
    id: "planned",
    name: "Planned next",
    tools: PDF_PLANNED_IDS.map((id) =>
      allEntries.find((tool) => tool[0] === id),
    ),
  },
  ...groups
    .map((group) => ({
      ...group,
      tools: group.tools.filter(
        ([id]) => !prioritized.has(id) && !PDF_TOOL_ALIASES[id],
      ),
    }))
    .filter((group) => group.tools.length),
];

export const PDF_TOOL_GROUPS = Object.freeze(
  studioGroups.map((group) =>
    Object.freeze({
      ...group,
      tools: Object.freeze(
        group.tools.map(([id, name, description]) =>
          Object.freeze({
            id,
            name,
            description,
            groupId: group.id,
            status: PDF_READY_IDS.includes(id)
              ? "ready"
              : PDF_PLANNED_IDS.includes(id)
                ? "planned"
                : "coming-soon",
            href: `/tools/pdf/${id}`,
          }),
        ),
      ),
    }),
  ),
);

export const PDF_TOOLS = Object.freeze(
  PDF_TOOL_GROUPS.flatMap((group) => group.tools),
);
