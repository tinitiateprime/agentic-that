# AgenticThat Companion 2.1.16

## Primary domain

- Opens the embedded publishing dashboard at `https://agenticthat.com/publishing`.
- Uses `https://agenticthat.com` for installer metadata and publishing-extension trust checks.
- Removes the legacy Netlify hostname from the Companion and publishing-extension release configuration.

## LinkedIn managed Pages

- Includes the LinkedIn managed-Page discovery and destination publishing support introduced in 2.1.14.
- Includes the asynchronous LinkedIn Manage-card detection fix introduced in 2.1.15.

## Release security

- Updates Sharp to 0.35.4 in the Companion and cross-platform native packages.
- Updates the website build to Next.js 15.5.25.
- Passes production dependency audits with no known vulnerabilities.
