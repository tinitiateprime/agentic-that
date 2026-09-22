# AI Website Studio

The AI Website Studio is a global-admin-only delivery pipeline for generating, validating, delivering, selecting, and publishing business websites.

## Automatic workflow

1. A global administrator supplies verified client and business information once.
2. Gemini returns a schema-constrained website content and creative-direction system. Temporary overloads are retried with exponential backoff and automatically fail over from Gemini 3.8 Flash to 3.7 Flash. Lite models are excluded from client-ready generation. Large service catalogues are split into bounded parallel batches and merged back into their original order automatically.
3. The server checks service grounding, section completeness, heading length and uniqueness, content depth, placeholders, colours, and unsupported claims.
4. A failed content quality check is sent through one automatic repair attempt. Failed output is never delivered.
5. Website Studio V3 renders three structurally independent responsive concepts: Editorial uses an alternating magazine narrative, Momentum uses a full-bleed conversion layout and bento service system, and Aura uses an immersive showcase with floating proof and image-led service chapters.
6. Before delivery, a real Chromium browser renders all three concepts at desktop and mobile sizes. The automatic gate checks response health, concept structure, overflow, images, type scale, heading contrast and repetition, page length, navigation, and contact actions.
7. Private preview links are emailed to the client automatically only after all six rendered views pass.
8. Selecting a concept atomically publishes it at `/sites/{business-slug}`. There is no admin review, approval, or separate publish action.

## Required production configuration

```env
DATABASE_URL=postgresql://...
GEMINI_API_KEY=...
GEMINI_WEBSITE_MODEL=gemini-3.8-flash
# Optional: override the automatic fallback order.
GEMINI_WEBSITE_MODELS=gemini-3.8-flash,gemini-3.7-flash
GEMINI_WEBSITE_TIMEOUT_MS=55000
GEMINI_WEBSITE_RETRY_DELAY_MS=900
PEXELS_API_KEY=your-free-pexels-api-key
PLATFORM_PUBLIC_URL=https://your-domain.example
AUTH_EMAIL_FROM=AgenticThat <website@your-domain.example>
RESEND_API_KEY=...
```

`AUTH_EMAIL_WEBHOOK_URL` can be used instead of Resend. Development without an email provider still creates all preview links and reports delivery as skipped.

Apply `supabase/migrations/202609210001_admin_ai_website_studio.sql` through the existing approval-gated production migration workflow before deploying the feature.

## Security and reliability

- Every management endpoint requires the existing global-admin authorization check.
- Public previews use 256-bit capability tokens; only their SHA-256 digests are stored.
- Website data tables use RLS and grant no browser database access.
- Published pages expose only projects that have completed client selection.
- AI output cannot introduce services that were not supplied in the verified brief.
- Every supplied service is preserved. There is no fixed catalogue-size limit; bounded Gemini batches prevent large briefs from overflowing a single model response.
- Gemini infers a service-aware multi-page information architecture: homepage, services index, one detail page per service, about, and contact.
- Pexels photography is ranked from larger AI-directed candidate pools for relevance, landscape composition, resolution, and photographer diversity. Duplicate assets are prevented across hero, story, gallery, and services; client-supplied photos take priority. Credits are available from the discreet footer credits panel rather than covering every image.
- All navigation, service links, booking/email/phone actions, mobile menus, and the future-ready floating call control use real destinations.
- Stalled generations fail closed, and administrators are limited to one active generation and ten starts per hour.
- Failed projects keep their verified brief and expose a one-click Retry action in the admin delivery pipeline.
- Preview pages are marked `noindex`, `nofollow`, `nocache`, and `no-referrer`.

## Current publishing boundary

Publishing activates the selected site immediately on the AgenticThat platform URL. Custom-domain provisioning, external deployment targets, booking automation, CRM capture, and the browser voice receptionist remain separate milestones and should attach to the same structured business profile rather than create duplicate business data.
