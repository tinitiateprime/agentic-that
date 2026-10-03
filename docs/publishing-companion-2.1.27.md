# AgenticThat Companion 2.1.27

This release fixes browser closing for LinkedIn media posts and YouTube video
uploads.

LinkedIn image and video posts now retain the browser for a 90-second safety
window after the provider accepts the post. If LinkedIn still shows uploading
or processing activity after that window, Companion continues waiting until
the activity clears.

YouTube now treats either a stable `Upload complete` message or the active
video's stable `Video processing` confirmation as a successful upload handoff.
An active uploading message always takes priority and keeps Studio open. Once
the upload is handed off, Companion closes the confirmation and browser without
waiting for YouTube's server-side SD/HD processing.

The YouTube processing handoff behavior was verified against the live Studio
dialog that appears when Studio skips the brief 100% upload state.
