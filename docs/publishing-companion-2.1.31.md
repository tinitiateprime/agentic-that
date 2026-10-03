# AgenticThat Companion 2.1.31

X publishing acknowledges informational notices with Got it and closes Premium
offers before opening or using the composer. Stacked notices are dismissed in
order, and the post editor and sign-in dialogs remain open. Final posting uses
a trusted browser click so an overlay cannot receive the intended Post click.

Video publishing waits for the attachment's Uploading and Processing states to
clear. A visible video preview alone no longer counts as a completed upload.
Unrelated progress indicators do not prevent a ready attachment from posting.

Browser regression tests cover stacked terms and Premium notices, preserving
the editor and sign-in dialogs, and waiting through video processing. Actual
production delivery and operating-system release checks are recorded separately.
