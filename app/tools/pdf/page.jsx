import PdfStudio from "@platform/pdf/PdfStudio";

export const metadata = {
  title: "Free PDF tools — merge, split, convert | AgenticThat PDF Studio",
  description:
    "Merge, split, organize, and convert PDFs privately in your browser.",
  alternates: { canonical: "/tools/pdf" },
};
export const viewport = { themeColor: "#0b111b" };

export default function PdfStudioPage() {
  return <PdfStudio />;
}
