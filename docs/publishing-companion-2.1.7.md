# AgenticThat Companion 2.1.7

- Facebook numeric `profile.php?id=...`, `/people/.../id`, and canonical `/p/...-id` profiles share the correct identity. Numeric profiles use Facebook's `reels_tab` route.
- Public page JSON fragments are joined by their story, video, author, and feedback IDs. Missing counts remain unknown; compact visible counts retain their approximate precision.
- Direct posts and Reels look up their author's public follower count. Reel views are matched to the same Reel in the public Reels grid or its identified Video payload.
- Keywords and hashtags read the anonymous public feed, with public search discovery when needed. Search links are only candidates: dates, content, and metrics must be checked on the actual Facebook post. Indexed coverage can be partial and older than the latest feed.
- YouTube videos require explicit audience (made for kids / not made for kids) and visibility (private / unlisted / public) choices. These survive intake, editing, queue transport, and Companion execution. Studio radio selection must be confirmed before Save or Publish.
- Existing YouTube video jobs without choices need to be edited before retrying. Companion 2.1.7 is the minimum version so earlier versions cannot ignore private or unlisted choices.

Validation: automated Facebook and publishing tests, production website build, and local Chromium checks for all six YouTube option combinations. Anonymous live checks returned results for the supplied numeric Facebook profile, direct Reel views and followers, direct post followers, hashtags, and keyword search. Live YouTube publishing and installation on each user's OS still require account/device testing.

All desktop targets use the same implementation: Windows x64, macOS universal (Intel and Apple silicon), Linux x64 and arm64.
