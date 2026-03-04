# Privacy Policy

**IndexLens** is a Chrome extension for browsing Elasticsearch clusters. Your privacy is important — this extension is designed to keep all data local to your device.

## No Data Collection

IndexLens does **not** collect, transmit, or share any user data. There is no analytics, telemetry, crash reporting, or tracking of any kind.

## Local-Only Storage

All data is stored locally on your device using `chrome.storage.local` and `localStorage`. Nothing is sent to external servers or third-party services.

### What's Stored

- **Cluster credentials** — encrypted connection details for your Elasticsearch clusters
- **UI preferences** — settings such as vim mode toggle and last-selected cluster
- **REST query history** — previously executed queries for convenience

## Encryption

Cluster credentials are encrypted at rest using **AES-GCM 256-bit** encryption. The encryption key is derived from your passphrase using **PBKDF2 with 600,000 iterations**. Your passphrase is never persisted to disk — it is held in memory only for the duration of your session.

## Network Requests

IndexLens makes network requests **only** to the Elasticsearch clusters you configure. No data is ever sent to third-party services, external APIs, or the extension developer.

## Permissions Justification

- **`storage`** — used to persist encrypted cluster credentials and UI preferences locally on your device.
- **Broad `host_permissions`** — required because Elasticsearch clusters can run on any domain or port. The extension needs permission to connect to whatever cluster URL you configure.

## Contact

If you have questions about this privacy policy, please open an issue on the [GitHub repository](https://github.com/labanar/indexlens).
