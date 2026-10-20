# Contributing

Run the tests, build and publication check before submitting a change:

```bash
export SIE_PYTHON="$PWD/.venv/bin/python"
npm test
npm run build
npm run check:publication
```

Enable the local check of exact staged contents:

```bash
git config core.hooksPath .githooks
```

Use synthetic fixtures and placeholder configuration. Do not add credentials,
connection files, uploaded documents, databases, logs, screenshots of private
workspaces, personal contact information or institutional branding.

The automated check detects common credential formats and excluded file paths.
Review all newly added content and metadata before publishing; a passing check
is not a guarantee that arbitrary private information is absent.

New examples should be reproducibly generated without accessing user data.
Keep attribution and license notices for third-party code or datasets.
