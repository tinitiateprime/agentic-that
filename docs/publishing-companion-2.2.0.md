# AgenticThat Companion 2.2.0

## Free local AI for Social SEO

The Companion can now run a free, open-source AI on your own computer that writes ready-to-post SEO posts for
Instagram, Facebook, LinkedIn and YouTube from the Social SEO page. Your photos and videos never leave your computer.

- **Model**: Qwen3-VL (Apache 2.0) with llama.cpp, downloaded once on first use and checked against pinned SHA-256
  checksums. Standard (4B) is recommended; High quality (8B) and Lite (2B) are also offered.
- **Reads the whole post**: its message, mood and type (selling, quote, tips, humour, news or personal), the brand,
  every list exactly as written (sections, columns and step flows), the slogan and contact details.
- **Writes each app in its own format**, with complete lists, the slogan, a DM line on Instagram, contacts and local
  hashtags for business posts, and message-first captions for creator posts. Invented urgency ("limited slots") and
  promises the owner never made are removed.
- **SEO score out of 10** for every app, with a tip for each missing point.
- **Live writing**: the caption appears word by word while it is written.
- **Speed**: measures the graphics and processor engines once and keeps the faster; reuses fixed instructions between
  posts; never stops a long post on a slow computer. The chosen model is always used: low free memory only makes it
  slower, and the page then suggests closing other apps.

Validation: 562 automated tests (78 for Social SEO), TypeScript, production website build, and real AI runs on course
posters and quote posts for all four apps on a Windows laptop (Ryzen 7 5700U, 14 GB RAM).

All desktop targets use the same implementation: Windows x64, macOS universal (Intel and Apple silicon), Linux x64 and
arm64.
