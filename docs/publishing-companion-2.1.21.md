# AgenticThat Companion 2.1.21

This release fixes YouTube Community image posts that remained in the composer
without showing a usable preview. Companion continues to transfer the local
image path through Chromium's CDP channel, then emits the input and change
events YouTube requires to render the selected image and enable Post.

The behavior is enabled only for YouTube Community images. YouTube videos and
all other publishing platforms keep their existing media flow.
