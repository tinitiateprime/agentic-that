import { notFound, redirect } from "next/navigation";
import PdfStudio from "@platform/pdf/PdfStudio";
import { PDF_TOOLS, PDF_TOOL_ALIASES } from "@platform/tools-catalog";

export const viewport = { themeColor: "#0b111b" };

export async function generateMetadata({ params }) {
  const { tool } = await params;
  const item = PDF_TOOLS.find((entry) => entry.id === tool);
  return {
    title: `${item?.name || "PDF Studio"} | AgenticThat`,
    description: item?.description,
  };
}

export default async function PdfToolPage({ params }) {
  const { tool } = await params;
  if (PDF_TOOL_ALIASES[tool]) redirect(`/tools/pdf/${PDF_TOOL_ALIASES[tool]}`);
  const item = PDF_TOOLS.find((entry) => entry.id === tool);
  if (!item) notFound();
  return <PdfStudio tool={item} />;
}
