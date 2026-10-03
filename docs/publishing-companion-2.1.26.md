# AgenticThat Companion 2.1.26

This release separates YouTube video upload completion from server-side video
processing. A Studio row, dialog, or toast that says processing will begin is
ignored until the current upload first reports `Uploading 100%`, `Upload
complete`, or an equivalent explicit upload-complete message.

Below 100%, Companion leaves the upload dialog and browser open. At 100%, it
may close the completed upload overlay, waits for the matching video's
processing screen, and only then completes the job and closes YouTube.

The change is isolated to YouTube video publishing.
