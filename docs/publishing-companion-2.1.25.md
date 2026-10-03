# AgenticThat Companion 2.1.25

This release makes YouTube video completion strict. Companion keeps YouTube
Studio open while the current upload is below 100%, even if the upload dialog
briefly disappears from the page.

Companion completes the browser flow only after it observes Uploading 100% or
YouTube replaces the upload progress with a stable finished/processing state.
It then clicks Close when the completion dialog remains visible and lets
YouTube continue server-side processing.

The change is isolated to YouTube video completion.
