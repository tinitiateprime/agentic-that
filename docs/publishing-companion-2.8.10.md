# AgenticThat Companion 2.8.10

This is a QA prerelease. Windows and macOS QA downloads may be unsigned; macOS
may not be notarized.

## Discord: people who join later are added automatically

- Someone who wasn't in the Discord server when they were added to a group gets
  the invite link and shows as "Invite sent". Previously nothing happened when
  they joined later, so they never saw the group's private channel.
- While the Companion is running it now checks invited people once a minute. As
  soon as someone has joined the server, the bot gives them access to the group
  channel and they show as Added ("Joined the server and was added to the group").
- The check is quiet: it never messages the person again, changes nothing while
  they haven't joined, and pauses while Discord is disconnected. It works with a
  Discord username or a numeric user ID.

Validation: all 216 publishing tests and all 16 group tests passed, including new
checks that an invited person is added after joining, that nothing changes or is
re-sent before then, and that channel access is only given once they are in the
server. Not yet tried against a live Discord server.
