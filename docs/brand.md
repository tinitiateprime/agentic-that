# AgenticThat logo (Keystone @)

The symbol is an @ whose "a" stands for Agentic, with a T for That cut into the upper right.

## Files

All in `public/brand/`, built from one source by `scripts/build-brand-kit.mjs`.

| Use | File |
|---|---|
| Website header, documents (light background) | `agenticthat-logo-horizontal.svg` |
| Dark background | `agenticthat-logo-horizontal-dark.svg` (gold symbol, white name) |
| Single color on dark | `agenticthat-logo-horizontal-white.svg` |
| Covers, slides | `agenticthat-logo-stacked.svg`, `agenticthat-logo-stacked-dark.svg` |
| Symbol only | `agenticthat-symbol.svg` (ink), `-gold.svg`, `-white.svg` |
| Marketing highlight (gold T) | `agenticthat-symbol-signature.svg` |
| Under 32 px | `agenticthat-symbol-micro.svg` |
| App icon | `agenticthat-app-icon.svg`, `agenticthat-app-icon-1024.png` |
| PNG masters | symbol 1024 / 2048, horizontal 2048 (light and dark) |

Favicons (`app/icon.svg`, `app/favicon.ico`, `app/apple-icon.png`) and the share image (`app/opengraph-image.png`) are generated too.

In React, use `BrandSymbol` and `BrandLogo` from `src/platform/BrandMark.jsx`. They draw the same paths as the files.

## Rules

- Colors: Ink `#171717`, Gold `#FACC15`, Ivory `#F5F2E9`, White `#FFFFFF`. Solid colors only: no gradients, shadows or outlines on the logo.
- Dark backgrounds: gold symbol, white name. Light backgrounds: ink symbol, ink name.
- Clear space: at least 0.25 × symbol height on every side.
- Smallest size: 32 px symbol height, or 140 px wide for the horizontal logo. Below 32 px use the micro symbol.
- The name is always "AgenticThat": capital A and T, no space. It is outlined from Outfit Bold with −0.04em tracking and a tighter c–T pair.

## Changing the logo

Edit the geometry in `scripts/brand/keystone.mjs`, then run:

```
npm i --no-save opentype.js@1.3.4
node scripts/build-brand-kit.mjs
```
