import styles from "./privacy.module.css";

export const metadata = {
  title: "Publishing Companion Privacy - AgenticThat",
  description: "Privacy information for the AgenticThat Publishing Companion Chrome extension.",
};

export default function PublishingCompanionPrivacyPage() {
  return (
    <main className={styles.page}>
      <article className={styles.card}>
        <a className={styles.brand} href="/">AgenticThat</a>
        <p className={styles.eyebrow}>Chrome extension privacy</p>
        <h1>Publishing Companion privacy policy</h1>
        <p className={styles.updated}>Effective July 23, 2026</p>

        <section>
          <h2>What the extension does</h2>
          <p>
            AgenticThat Publishing Companion connects the AgenticThat publishing dashboard to the
            Publishing Companion application installed on the same computer. It transfers publishing
            requests, selected media, and local media previews only between those two components.
          </p>
        </section>

        <section>
          <h2>Data handling</h2>
          <p>
            To provide this local bridge, the extension handles user-provided post text, selected
            images or videos, schedules and publishing actions; AgenticThat dashboard authentication
            information forwarded to the local companion; and locally returned workspace and
            connected-account identifiers used by the publishing dashboard.
          </p>
          <p>
            This information is transferred only between the AgenticThat dashboard and the companion
            running on the same computer. The extension does not retain it or send it to AgenticThat
            servers. Publishing metadata, selected media, schedules, and saved browser sessions remain
            in the local companion data directory.
          </p>
          <p>
            The extension does not receive or store social-network passwords or verification codes.
            Users enter those details manually on each social network&apos;s own Chrome page.
          </p>
        </section>

        <section>
          <h2>Access and retention</h2>
          <p>
            Access is limited to the AgenticThat dashboard and the local companion address
            <code>127.0.0.1:8792</code>. The extension itself does not retain publishing requests.
            Users can remove all locally stored publishing data by choosing <strong>Open local
            data</strong> in the companion, quitting the companion, and deleting that folder.
          </p>
        </section>

        <section>
          <h2>Sharing and limited use</h2>
          <p>
            AgenticThat does not sell extension data, use it for advertising, or transfer it for
            purposes unrelated to the extension&apos;s single purpose. Use of information handled by
            this extension complies with the Chrome Web Store User Data Policy, including the Limited
            Use requirements.
          </p>
        </section>

        <a className={styles.back} href="/publishing">Return to publishing</a>
      </article>
    </main>
  );
}
