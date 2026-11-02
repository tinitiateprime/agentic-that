import PdfStudio from "@platform/pdf/PdfStudio";

export const metadata = {
  title: "PDF Studio | AgenticThat",
  description:
    "Merge, split, organize, and convert PDFs privately in your browser.",
};
export const viewport = { themeColor: "#0b111b" };

export default function PdfStudioPage() {
  return <PdfStudio />;
}
