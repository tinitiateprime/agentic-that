import BrandLoader from "@platform/BrandLoader";
import styles from "@platform/global-loader.module.css";

// Shown while a route's server content is loading.
export default function Loading() {
  return (
    <div className={styles.page}>
      <BrandLoader label="Loading" />
    </div>
  );
}
