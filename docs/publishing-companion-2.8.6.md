# AgenticThat Companion 2.8.6

This is a QA prerelease. Windows and macOS QA downloads may be unsigned; macOS
may not be notarized.

## Long videos

- Social SEO listens to the video on this computer and writes a timed
  transcript, so the AI can work from everything that is said even when the
  video is too long to hand over. The speech tools (about 160 MB) download once,
  on first use, and are checked against pinned hashes.
- Chapters use real moments from the video, and up to 24 moments are sent as
  picture sheets.
- Before posting, the website shows where the video can go. LinkedIn and Reddit
  are blocked over 15 minutes. YouTube, X, Instagram and Facebook show a warning
  when the video is over the usual limit for an account.

## Posts close when the app confirms them

Each app's window closes as soon as that app confirms the post. Time limits only
apply when an app never answers, and they now grow with the file size.

- YouTube stays open until every byte is sent, then checks Studio's result for
  the video and reports it if YouTube refused it.
- Facebook stays open until a video has been fully sent.
- Instagram waits up to 30 minutes for "Reel shared" on large videos.
- LinkedIn clicks Post only after it has received the whole video, and shows
  LinkedIn's own message when it refuses a post.
- X and Reddit upload limits run from 15 minutes to 2 hours by file size. Reddit
  waits longer to confirm a new video post.

A clear refusal from an app is reported as a failure in that app's own words. It
is not retried and it does not pause the account.

## Human verification

When an app asks for a CAPTCHA or "verify it's you" before Post is clicked, that
account's window comes forward and shows Needs you. Posting waits up to 10
minutes, then continues once the person has finished. If the check appears after
Post was clicked, the Companion asks the person to check the app before posting
again, so a post is not duplicated.

## Faster transfers

- The Companion downloads a video in six parallel parts. A 130 MB video went
  from 4 min 40 s to 49 s.
- The website keeps uploading parts while earlier ones are confirmed.
- Progress and the real preparation error are shown on the job.

Validation: all 189 publishing tests passed. Speech on a 17-minute video, the
parallel download, YouTube and Facebook upload tracking and Instagram Create were
checked live. Human verification was tested on simulated screens only. The
website upload speed, the longer time limits on real large posts, and speech on
macOS and Linux were not tested live.
