# AgenticThat Companion 2.1.24

This release corrects the final YouTube video handoff. The post-Publish
"Video uploading" dialog is now treated as an active file transfer, including
its visible percentage and remaining-time message. Companion keeps the YouTube
tab open during that stage.

When YouTube changes to "Processing will begin shortly" (or another durable
published/processing confirmation), Companion clicks the confirmation Close
button and closes its YouTube browser. YouTube can then complete processing on
its servers.

The change is isolated to YouTube video completion. Other publishing and Admin
Center work is unchanged.
