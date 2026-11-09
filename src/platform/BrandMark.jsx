import { SYMBOL, SYMBOL_MICRO, WORDMARK_HORIZONTAL } from "./brand-paths";

// The Keystone @ symbol. Draws in currentColor, so it follows the text color around it.
// Without a size it scales with the font size, like the "AT" text it replaces.
/** @param {{ size?: number | string, micro?: boolean, title?: string, className?: string, style?: import("react").CSSProperties }} [props] */
export function BrandSymbol({ size, micro = false, title, className, style } = {}) {
  const k = micro ? SYMBOL_MICRO : SYMBOL;
  const dimension = size ?? "1.3em";
  return (
    <svg
      viewBox="4 4 92 92"
      width={dimension}
      height={dimension}
      className={className}
      style={{ display: "inline-block", flex: "none", verticalAlign: "middle", ...style }}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <path d={k.ring} fill="currentColor" />
      <path d={k.a} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

// Horizontal lockup: symbol plus outlined "AgenticThat" name, set by height.
// The name uses currentColor; the symbol can take its own color (gold on dark backgrounds).
/** @param {{ height?: number | string, symbolColor?: string, title?: string, className?: string, style?: import("react").CSSProperties }} [props] */
export function BrandLogo({ height = 32, symbolColor = "currentColor", title = "AgenticThat", className, style } = {}) {
  return (
    <svg
      viewBox={WORDMARK_HORIZONTAL.viewBox}
      height={height}
      className={className}
      style={{ display: "block", width: "auto", flex: "none", ...style }}
      role="img"
      aria-label={title}
      focusable="false"
    >
      <path d={SYMBOL.ring} fill={symbolColor} />
      <path d={SYMBOL.a} fill={symbolColor} fillRule="evenodd" />
      <path d={WORDMARK_HORIZONTAL.d} fill="currentColor" />
    </svg>
  );
}
