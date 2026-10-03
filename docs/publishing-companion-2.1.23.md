# AgenticThat Companion 2.1.23

This release makes YouTube Studio video delivery durable on slower uploads.
Companion now reads rejection messages only from the active upload dialog,
current video row, or a live Studio toast, so an older "Processing abandoned"
notice cannot fail a new upload. It also keeps Studio open while the current
video reports an active upload percentage and allows server-side processing to
continue after the file transfer finishes.

If YouTube accepted the final Publish action but Companion cannot confirm the
result, the Companion and publishing dashboard now show **Check Studio** instead
of presenting the attempt as an ordinary failed post. Such an attempt is never
automatically retried, preventing duplicate videos.

The change is isolated to YouTube video completion and its result display. Other
social publishing flows are unchanged.
