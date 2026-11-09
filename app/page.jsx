import PlatformHome from "@platform/PlatformHome";
import { getCurrentPlatformUser } from "@platform/server/auth-store";
import { redirect } from "next/navigation";
import { CONTACT_EMAIL, LOCATION, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@platform/site-config";
import { siteFaq } from "@platform/site-faq";

// The home page also answers /?auth=login and /?next=..., so point search engines at the bare URL.
export const metadata = {
  alternates: { canonical: "/" },
};

// Structured data: tells search engines and AI assistants what AgenticThat is and what it offers.
const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: SITE_NAME,
      url: `${SITE_URL}/`,
      description: SITE_DESCRIPTION,
      logo: {
        "@type": "ImageObject",
        url: `${SITE_URL}/brand/agenticthat-logo-512.png`,
        width: 512,
        height: 512,
      },
      image: `${SITE_URL}/opengraph-image.png`,
      email: CONTACT_EMAIL,
      address: {
        "@type": "PostalAddress",
        streetAddress: LOCATION.street,
        postalCode: LOCATION.postalCode,
        addressLocality: LOCATION.locality,
        addressRegion: LOCATION.region,
        addressCountry: LOCATION.country,
      },
      contactPoint: {
        "@type": "ContactPoint",
        contactType: "customer support",
        email: CONTACT_EMAIL,
        availableLanguage: ["English"],
      },
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: SITE_NAME,
      url: `${SITE_URL}/`,
      publisher: { "@id": `${SITE_URL}/#organization` },
      inLanguage: "en",
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE_URL}/#software`,
      name: SITE_NAME,
      url: `${SITE_URL}/`,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description: SITE_DESCRIPTION,
      publisher: { "@id": `${SITE_URL}/#organization` },
      featureList: [
        "AI Website Studio: three responsive website designs from one brief, delivered and published",
        "Chat workflow automation for WhatsApp and Telegram: contacts, campaigns, templates and inbox replies",
        "AI Phone Front Desk: an AI receptionist that answers calls, captures leads and summarizes them",
        "Instagram and Facebook public-data research: profiles, Pages, posts, reels and comments to JSON or CSV",
        "Scheduled publishing to Instagram, Facebook, X, LinkedIn, YouTube and Reddit",
      ],
    },
    {
      "@type": "FAQPage",
      "@id": `${SITE_URL}/#faq`,
      mainEntity: siteFaq.map(({ question, answer }) => ({
        "@type": "Question",
        name: question,
        acceptedAnswer: { "@type": "Answer", text: answer },
      })),
    },
  ],
};

export const viewport = {
  themeColor: "#02060d",
};

function safeNextPath(value) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "";
}

export default async function HomePage({ searchParams }) {
  const params = await searchParams;
  const user = await getCurrentPlatformUser();
  const nextPath = safeNextPath(params?.next);
  if (user && nextPath) redirect(nextPath);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
      />
      <PlatformHome
        initialUser={user ? { id: user.id, name: user.name, email: user.email } : null}
        initialAuthMode={params?.auth === "signup" ? "signup" : params?.auth === "login" ? "login" : ""}
        initialNextPath={nextPath}
      />
    </>
  );
}
