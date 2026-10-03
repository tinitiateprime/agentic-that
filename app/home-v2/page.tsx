import type { Metadata } from "next";
import HomePage from "@/src/marketing/HomePage.tsx";
import "./home-v2.css";

export const metadata: Metadata = {
  title: "AgenticThat — Autonomous agents for scraping, publishing & messaging",
  description:
    "Deploy headless browser agents that extract structured data, schedule social publishing, and run messaging workflows from one control plane.",
};

export default function HomeV2Page() {
  return <HomePage />;
}
