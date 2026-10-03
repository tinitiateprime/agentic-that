import type { Variants } from "framer-motion";

/**
 * Shared "expo out" curve. Every entrance in the marketing page uses this so
 * the whole surface feels like one system rather than a pile of components.
 */
export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** Default `whileInView` viewport config — animate once, when 20% is visible. */
export const VIEWPORT_ONCE = { once: true, amount: 0.2 } as const;

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.5, ease: EASE_OUT } },
};

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE_OUT } },
};

export const fadeInLeft: Variants = {
  hidden: { opacity: 0, x: -22 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.6, ease: EASE_OUT } },
};

export const fadeInRight: Variants = {
  hidden: { opacity: 0, x: 22 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.6, ease: EASE_OUT } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.5, ease: EASE_OUT } },
};

/** Parent variant that releases its children one after another. */
export function staggerContainer(stagger = 0.08, delayChildren = 0): Variants {
  return {
    hidden: {},
    visible: { transition: { staggerChildren: stagger, delayChildren } },
  };
}
