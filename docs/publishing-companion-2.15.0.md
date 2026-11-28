# AgenticThat Companion 2.15.0

This is a QA prerelease. Windows and macOS QA downloads may be unsigned; macOS
may not be notarized.

## Published posts remember their link

- After a post is published, the Companion now records where it lives on the
  platform, and the workspace keeps it with the post. The Reports page uses it
  for "Open post", so anyone in the company can open the post in its app.
- **YouTube:** the new video's link (youtu.be/…), from the upload dialog.
- **Reddit:** the new post's link.
- **LinkedIn** and **X:** the link in the "Post successful · View post" /
  "Your post was sent · View" message the platform shows right after posting.
- **Facebook** and **Instagram** don't show a link after posting; for those,
  Reports keeps matching the post to Social Manager's copy when it can.
- Reading the link is read-only, takes a few seconds at most, and never makes a
  post that went out count as failed.

Validation: type check, Social Manager, publishing and job-queue tests pass.
Not yet tried on a real post: the first post on each platform with this
version will show whether the link was read.
