import { BrandLogo } from "./BrandMark";
import { CONTACT_EMAIL, LOCATION } from "./site-config";
import styles from "./site-footer.module.css";

// Plain links on every public page help search engines find and group the site's pages.
const columns = [
  {
    title: "Products",
    links: [
      { label: "Messaging automation", href: "/#messaging" },
      { label: "Social scraping", href: "/#scraping" },
      { label: "Scheduled publishing", href: "/#publishing" },
      { label: "App Store", href: "/apps" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "FAQ", href: "/#faq" },
      { label: "Contact", href: "/about#contact" },
      { label: "Companion privacy", href: "/publishing/privacy" },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Sign in", href: "/?auth=login" },
      { label: "Create account", href: "/?auth=signup" },
    ],
  },
];

export default function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.brandCol}>
          <a className={styles.brand} href="/" aria-label="AgenticThat home">
            <BrandLogo height={30} symbolColor="#FACC15" />
          </a>
          <p>AI agents for messaging, scraping, publishing and engagement, run from one workspace.</p>
          <address className={styles.contact}>
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            <span>{LOCATION.label}</span>
          </address>
        </div>
        <nav className={styles.columns} aria-label="Footer">
          {columns.map((column) => (
            <div key={column.title}>
              <h2>{column.title}</h2>
              <ul>
                {column.links.map((link) => (
                  <li key={link.href}><a href={link.href}>{link.label}</a></li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <p className={styles.legal}>© {new Date().getFullYear()} AgenticThat</p>
    </footer>
  );
}
