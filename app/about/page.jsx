import SiteFooter from "@platform/SiteFooter";
import { BrandLogo } from "@platform/BrandMark";
import { CONTACT_EMAIL, LOCATION, OG_IMAGE, SITE_NAME, SITE_URL } from "@platform/site-config";
import styles from "./about.module.css";

const title = "About AgenticThat";
const description =
  "AgenticThat builds AI agents for the online side of a business: websites, messaging, phone calls and social posting in one workspace, with people in control.";

export const metadata = {
  title: `${title} — AI agents for business`,
  description,
  alternates: { canonical: "/about" },
  openGraph: { title, description, url: `${SITE_URL}/about`, type: "website", siteName: SITE_NAME, images: [OG_IMAGE] },
};

export const viewport = { themeColor: "#02060d" };

const principles = [
  {
    title: "One operating layer",
    text: "Messaging, scraping, publishing and engagement stay connected instead of living in separate tools.",
  },
  {
    title: "Context that moves with the work",
    text: "Requests, connected accounts, operating rules and outcomes stay part of the same workflow.",
  },
  {
    title: "Execution that fits the job",
    text: "Managed execution handles supported work. The Local Companion handles tasks that need a signed-in account.",
  },
  {
    title: "Control you can see",
    text: "Human review, visible sessions and returned status keep every important action accountable.",
  },
];

const products = [
  { name: "AI Website Studio", detail: "Three website designs from one short brief, then delivered and published.", status: "Live" },
  { name: "Messaging automation", detail: "WhatsApp and Telegram: contacts, campaigns, templates and inbox replies.", status: "Live" },
  { name: "AI Phone Front Desk", detail: "An AI receptionist that answers calls, captures leads and summarizes them.", status: "Live" },
  { name: "Scheduled publishing", detail: "Instagram, Facebook, X, LinkedIn, YouTube and Reddit from one publish queue.", status: "Live" },
  { name: "Public-data research", detail: "Public Instagram and Facebook data, exported as JSON or CSV.", status: "Live" },
  { name: "Post engagement", detail: "Reviewable replies and interactions across social channels.", status: "Coming soon" },
  { name: "SEO and AI visibility", detail: "Keyword research, site audits and AI visibility checks.", status: "Coming soon" },
];

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "AboutPage",
      "@id": `${SITE_URL}/about#page`,
      url: `${SITE_URL}/about`,
      name: title,
      description,
      about: { "@id": `${SITE_URL}/#organization` },
      isPartOf: { "@id": `${SITE_URL}/#website` },
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
        { "@type": "ListItem", position: 2, name: "About", item: `${SITE_URL}/about` },
      ],
    },
  ],
};

export default function AboutPage() {
  return (
    <main className={styles.page}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
      />

      <header className={styles.top}>
        <a className={styles.brand} href="/" aria-label="AgenticThat home"><BrandLogo height={32} symbolColor="#FACC15" /></a>
        <nav className={styles.topNav} aria-label="Main navigation">
          <a href="/#messaging">Messaging</a>
          <a href="/#publishing">Publishing</a>
          <a href="/#scraping">Scraping</a>
          <a href="/#faq">FAQ</a>
          <a className={styles.topCta} href="/?auth=signup">Create account</a>
        </nav>
      </header>

      <section className={styles.hero} aria-labelledby="about-title">
        <p className={styles.eyebrow}><i />About AgenticThat</p>
        <h1 id="about-title">We build AI agents that run the online side of a business.</h1>
        <p className={styles.lede}>
          Teams juggle a website, chat apps, phone calls, scheduling tools, spreadsheets of research data and a dozen social logins.
          AgenticThat brings that work into one workspace, where agents do the repetitive parts and people
          stay in charge of what goes out.
        </p>
      </section>

      <section className={styles.block} aria-labelledby="what-title">
        <div className={styles.blockHead}>
          <p className={styles.eyebrow}><i />What we offer</p>
          <h2 id="what-title">What runs on AgenticThat today</h2>
        </div>
        <ul className={styles.products}>
          {products.map((product) => (
            <li key={product.name}>
              <div>
                <h3>{product.name}</h3>
                <p>{product.detail}</p>
              </div>
              <span className={product.status === "Live" ? styles.live : styles.soon}>{product.status}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.block} aria-labelledby="how-title">
        <div className={styles.blockHead}>
          <p className={styles.eyebrow}><i />How we work</p>
          <h2 id="how-title">Four principles behind every agent</h2>
        </div>
        <div className={styles.principles}>
          {principles.map((principle) => (
            <article key={principle.title}>
              <h3>{principle.title}</h3>
              <p>{principle.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.block} aria-labelledby="safety-title">
        <div className={styles.blockHead}>
          <p className={styles.eyebrow}><i />Your accounts</p>
          <h2 id="safety-title">Your passwords stay on your computer</h2>
        </div>
        <div className={styles.prose}>
          <p>
            Some tasks need a signed-in social account, such as publishing a post. For those, AgenticThat uses
            the Local Companion, a small app that runs on your own machine. Your social media passwords stay
            there and are never sent to AgenticThat servers.
          </p>
          <p>
            Read the <a href="/publishing/privacy">Publishing Companion privacy policy</a> for exactly what
            the companion handles.
          </p>
        </div>
      </section>

      <section id="contact" className={styles.block} aria-labelledby="contact-title">
        <div className={styles.blockHead}>
          <p className={styles.eyebrow}><i />Contact</p>
          <h2 id="contact-title">Talk to us</h2>
        </div>
        <dl className={styles.contact}>
          <div>
            <dt>Email</dt>
            <dd><a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></dd>
          </div>
          <div>
            <dt>Address</dt>
            <dd>{LOCATION.label}</dd>
          </div>
        </dl>
      </section>

      <section className={styles.cta} aria-labelledby="cta-title">
        <h2 id="cta-title">See the agents at work</h2>
        <p>Create an account, choose the apps your team needs and connect their accounts.</p>
        <div className={styles.ctaRow}>
          <a className={styles.primary} href="/?auth=signup">Create account</a>
          <a className={styles.secondary} href="/#faq">Read the FAQ</a>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
