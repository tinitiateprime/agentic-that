import styles from "./brand-loader.module.css";

// The AgenticThat "AT" mark with gold rings spinning around it.
// size: "page" (full-screen / route loading) or "compact" (floating badge).
export default function BrandLoader({ size = "page", label = "Loading" }) {
  return (
    <span className={`${styles.loader} ${size === "compact" ? styles.compact : ""}`} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true">
        <span className={styles.ringOuter} />
        <span className={styles.ringInner} />
        <span className={styles.mark}>AT</span>
      </span>
      <span className={styles.label}>{label}</span>
    </span>
  );
}
