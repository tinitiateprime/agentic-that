# AgenticThat Companion 2.1.3 release notes

Companion 2.1.3 fixes upgrades from the former **AgenticThat Publishing
Companion** desktop name.

## Fixed

- Recovers the exact website/Supabase account IDs for the currently paired
  workspace, so a successful local login updates the same website account.
- Recovers only those accounts' protected Electron partitions and dedicated
  external Chrome profiles instead of copying unrelated browser data.
- Preserves the current Companion's newer account state when an old record has
  the same ID, making the migration safe to repeat.
- Removes obsolete Windows autostart entries that could launch an older source
  or portable Companion alongside the installed app.
- Keeps X and YouTube on their required persistent external-browser profiles on
  Windows, macOS, and Linux.

These QA packages are unsigned. Windows SmartScreen, macOS Gatekeeper, or Linux
package-manager warnings can therefore appear during installation.
