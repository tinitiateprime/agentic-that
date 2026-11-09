import { siteFaq } from "./site-faq";
import styles from "./site-faq.module.css";

// Uses native <details> so every answer is in the page HTML (readable by search engines)
// and works with a keyboard without any script.
export default function SiteFaq() {
  return (
    <section id="faq" className={styles.faq} aria-labelledby="faq-title">
      <div className={styles.intro}>
        <p className={styles.eyebrow}><i />Questions</p>
        <h2 id="faq-title">Frequently asked questions</h2>
        <p>Short answers about what AgenticThat does, which channels it supports, and how your accounts stay safe.</p>
      </div>
      <div className={styles.list}>
        {siteFaq.map(({ question, answer }, index) => (
          <details key={question} className={styles.item} open={index === 0}>
            <summary>
              <h3>{question}</h3>
              <span className={styles.toggle} aria-hidden="true" />
            </summary>
            <p>{answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
