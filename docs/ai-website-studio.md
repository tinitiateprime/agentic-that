# AI Website Studio

The AI Website Studio is a global-admin-only delivery pipeline for generating, validating, delivering, selecting, and publishing business websites.

## Automatic workflow

1. A global administrator supplies verified client and business information once.
2. Gemini returns a schema-constrained website content system. Large service catalogues are split into bounded parallel batches and merged back into their original order automatically.
3. The server checks service grounding, section completeness, content depth, placeholders, colours, and unsupported claims.
4. A failed quality check is sent through one automatic repair attempt. Failed output is never delivered.
5. The shared website engine renders three independent responsive concepts: Editorial, Momentum, and Aura.
6. Private preview links are emailed to the client automatically.
7. Selecting a concept atomically publishes it at `/sites/{business-slug}`. There is no admin review, approval, or separate publish action.

## Required production configuration

```env
DATABASE_URL=postgresql://...
GEMINI_API_KEY=...
GEMINI_WEBSITE_MODEL=gemini-3.6-flash
GEMINI_WEBSITE_TIMEOUT_MS=55000
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
- Stalled generations fail closed, and administrators are limited to one active generation and ten starts per hour.
- Preview pages are marked `noindex`, `nofollow`, `nocache`, and `no-referrer`.

## Current publishing boundary

Publishing activates the selected site immediately on the AgenticThat platform URL. Custom-domain provisioning, external deployment targets, booking automation, CRM capture, and the browser voice receptionist remain separate milestones and should attach to the same structured business profile rather than create duplicate business data.
