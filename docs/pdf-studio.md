# PDF Studio

Entry point: `/tools/pdf`. The home page Tools menu links to nine working tools.

| Tool            | Route                      | Available actions                                                                                                    |
| --------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Merge           | `/tools/pdf/merge-pdf`     | Reorder documents, combine all pages, download one PDF                                                               |
| Split           | `/tools/pdf/split-pdf`     | Extract a selection, split by semicolon-separated groups, or create one PDF per page                                 |
| Organize        | `/tools/pdf/organize-pdf`  | Page previews, reorder, rotate, duplicate, delete, and append pages from other PDFs                                  |
| Images to PDF   | `/tools/pdf/images-to-pdf` | JPG/PNG/WebP, correct photo orientation, A4/Letter/fit, margins and orientation                                      |
| PDF to Images   | `/tools/pdf/pdf-to-images` | Selected pages, PNG/JPG, 72/144/216 DPI, single image or ZIP download                                                |
| Compress        | `/tools/pdf/compress-pdf`  | Three compression levels, supported image optimization, before/after sizes, original retained if already smaller     |
| PDF to Word     | `/tools/pdf/pdf-to-word`   | Selected text-based pages to an editable DOCX; optional page sections                                                |
| Word to PDF     | `/tools/pdf/word-to-pdf`   | DOCX headings, text, lists, tables, and embedded PNG/JPG images; A4/Letter, font size, custom font                   |
| Edit & annotate | `/tools/pdf/edit-pdf`      | Add/move text, highlights, rectangles, ellipses, freehand marks, images, and PDF comments; undo/redo; multiple pages |

All document processing runs in the browser. No uploaded files, persistence,
database tables, external conversion APIs, API keys, or paid services are needed.
Browser object URLs, PDF.js documents, render tasks, and operation state are
released on reset/navigation. Operations support cancellation and retain input
files when validation fails. Multiple outputs are packaged locally with fflate.

`pdf-lib` handles PDF operations. PDF.js handles previews and image export, with
scripting evaluation disabled. Its matching worker, fonts, character maps, ICC
profile, and decoder resources are served from the installed package through a
restricted, versioned GET route. `next.config.mjs` explicitly includes these files
in serverless output tracing. This route never accepts document uploads.

## Boundaries

- 30 files, 25 MB per file, 100 MB input total, 300 PDF pages per workspace/result.
- Image input: JPG, PNG, WebP; up to 24 megapixels and 16,000 pixels per side;
  combined decoded image budget of 100 megapixels and 100 MB of normalized bytes.
- PDF image export: up to 100 selected pages; maximum 24 megapixels and 16,000
  pixels per rendered side. Reduce resolution for oversized pages.
- At most 100 split output documents and 150 MB per result/archive.
- Password-protected PDFs must be unlocked by their owner before importing.
- XFA forms must be saved as a standard, flattened PDF before importing, to avoid
  losing form content during page operations.
- Merge/split/organize flatten interactive form appearances. Digital signatures,
  document bookmarks, and interactive form behavior are not preserved. Source
  documents are never modified. Unsupported form appearances produce an error.
- Image export is a rendering of pages, rather than extraction of embedded images.
- Compression retains the original document structure, selectable text, links,
  and form fields. Suitable RGB/gray JPEG and simple RGB images are recompressed.
  Masks, transparency, unusual color spaces/predictors, and EXIF-tagged embedded
  JPEGs are preserved unchanged. Image detail can soften at stronger settings.
  Some PDFs cannot be made smaller; in that case the original bytes are returned.
- PDF to Word exports editable text rather than raster page images. It groups
  text by position and creates Word paragraphs/optional sections. It does not
  reconstruct tables, columns, images, or the original typography. Scanned or
  textless selected pages produce an explicit OCR-required error, without
  silently dropping those pages.
- Word to PDF accepts DOCX, not legacy DOC or macro-enabled packages. It rebuilds
  a readable PDF from semantic content using Mammoth and pdfmake, rather than
  emulating Microsoft Word. Headers, footers, original fonts, floating drawings,
  and complex layouts are not preserved exactly. Embedded PNG/JPG images are
  supported. Unsupported image formats cause a clear conversion error. A custom local
  TTF/OTF font can be supplied for languages missing from the default Roboto font.
  Unsupported glyphs cause an error rather than silently creating missing text.
- DOCX directory declarations are checked before parsing: no encrypted/macro
  packages, 2,000 entries maximum, 25 MB per unpacked entry, 100 MB combined.
- The editor adds overlays and comments; it does not replace or redact original
  PDF text. It maps screen coordinates through page rotation, crop boxes, and
  page units. Existing form fields and document bookmarks remain in the source
  document. Added text uses embedded fonts; custom TTF/OTF fonts are supported.
  Limit: 500 annotations, 5,000 characters per annotation, 50 undo steps, 50 MB
  of inserted images, and a 150 MB saved document. Saving invalidates signatures.
- PDF processing libraries are loaded only on tool screens. A modern browser is
  required. The pinned PDF.js package requires Node 22.13+ or 24+ for installation.

## Roadmap

`src/platform/tools-catalog.js` is the source of truth for tool status. Nine tools
are `ready`. The next planned tools are Sign PDF, Fill PDF forms, and OCR PDF. Other existing ideas
remain future placeholders, without claiming they are already in development.
Format variants and actions already included in a working tool redirect to that
tool instead of advertising duplicate unavailable tools.

## Checks

Run `npm run test:pdf` for page order, rotation, ranges, copying, forms, image
layout, cancellation, validation, shared image resources, compression, editable
Word output, archive bounds, annotations, and rotated/cropped coordinates.

Start the app and run `npm run test:pdf:browser`. By default this uses the local
site at `http://127.0.0.1:5188` and an installed Chrome. Set
`PDF_STUDIO_TEST_URL` to test another local server; `PDF_TEST_BROWSER=msedge`
selects an installed Edge instead. The suite creates its own documents/images,
verifies real downloads and ZIP contents, checks mobile layout and errors, and
asserts that no document upload requests occur. Fixtures, downloaded outputs,
and screenshots are written to ignored `artifacts/pdf-studio-tests/`.

Run `npm run test:pdf:advanced:browser` for real compression, both Word conversion
directions, and annotation editing/downloads. This defaults to
`http://127.0.0.1:5189`; use `PDF_STUDIO_TEST_URL` to choose another running server.
Artifacts are written to ignored `artifacts/pdf-advanced-tests/`.

The production build is checked with `npm run build`.
