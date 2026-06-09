# GitHub Desktop Release Signing

This guide explains how Tabby desktop release builds are signed when they run in GitHub Actions.

## Current Release Workflow

The release workflow is `.github/workflows/desktop-release.yml`.

It runs when:

- A tag like `v0.3.2` is pushed.
- The workflow is manually dispatched with `tag_name`.

The tag must match `apps/desktop/package.json` exactly. For example, desktop version `0.3.2` must use tag `v0.3.2`.

The workflow builds:

- macOS arm64 DMG on `macos-14`.
- macOS x64 DMG on `macos-15-intel`.
- Windows x64 installer on `windows-latest`.

The workflow first creates or reuses the GitHub Release, then each platform job uploads its assets.

## macOS Signing

macOS signing and notarization are performed in GitHub Actions with the same production build path used locally:

```bash
pnpm --filter @nexu/desktop dist:mac:production
```

The workflow imports a Developer ID Application certificate into a temporary keychain on the GitHub runner, signs `Tabby.app`, creates a DMG, submits it to Apple notarization, staples the notarization ticket, then verifies the result with:

```bash
codesign --verify --deep --strict --verbose=2
xcrun stapler validate
spctl -a -vv --type exec
spctl --assess --type open --context context:primary-signature
```

### Required GitHub Secrets

Set these repository secrets in GitHub:

| Secret | Purpose |
|---|---|
| `APPLE_SIGNING_CERTIFICATE_BASE64` | Base64 content of the exported Developer ID Application `.p12` certificate. |
| `APPLE_SIGNING_CERTIFICATE_PASSWORD` | Password used when exporting the `.p12` certificate. |
| `APPLE_ID` | Apple ID email used for notarization. |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for notarization. |
| `APPLE_TEAM_ID` | Apple Developer Team ID, for example `WCYBD629RJ`. |

Optional:

| Secret | Purpose |
|---|---|
| `APPLE_KEYCHAIN_PASSWORD` | Password for the temporary GitHub runner keychain. If omitted, the workflow generates one. |
| `SENTRY_AUTH_TOKEN` | Enables sourcemap upload if the release scripts use it. |
| `POSTHOG_API_KEY` | Embeds the production PostHog key. |
| `LANGFUSE_PUBLIC_KEY` | Embeds Langfuse public key. |
| `LANGFUSE_SECRET_KEY` | Embeds Langfuse secret key. |
| `LANGFUSE_BASE_URL` | Embeds Langfuse base URL. |

### Export The Certificate

On the Mac that has the certificate in Keychain Access:

1. Open Keychain Access.
2. Find `Developer ID Application: ... (WCYBD629RJ)`.
3. Export it as a `.p12` file.
4. Set a strong export password.

Convert it to base64:

```bash
base64 -i DeveloperIDApplication.p12 -o DeveloperIDApplication.p12.base64
```

Copy the full file contents into the GitHub secret `APPLE_SIGNING_CERTIFICATE_BASE64`.

The export password goes into `APPLE_SIGNING_CERTIFICATE_PASSWORD`.

### Notarization Credentials

The current workflow uses Apple ID notarization credentials:

- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

The production script also supports keychain profiles and App Store Connect API keys, but GitHub Actions should use secrets instead of relying on a local keychain profile.

## Windows Signing

The Windows installer workflow currently builds and uploads an unsigned installer:

```bash
pnpm --filter @nexu/desktop dist:win
```

Apple Developer Program credentials cannot sign Windows installers. Windows Authenticode signing requires a separate Windows code signing certificate, such as:

- Standard OV code signing certificate.
- EV code signing certificate.
- Azure Trusted Signing or another provider with a CLI signing flow.

Until Windows signing is wired in, GitHub can build the Windows installer, but Windows SmartScreen may warn users because the executable is unsigned or has no reputation.

### Future Windows Signing Secrets

If using a PFX/P12 Windows code signing certificate later, add separate Windows-only secrets:

| Secret | Purpose |
|---|---|
| `WINDOWS_SIGNING_CERTIFICATE_BASE64` | Base64 content of the Windows code signing certificate. |
| `WINDOWS_SIGNING_CERTIFICATE_PASSWORD` | Password for that certificate. |

Do not reuse the Apple `.p12` certificate for Windows signing.

## Release Command

For a new release:

```bash
git checkout main
git pull --ff-only
pnpm version patch --no-git-tag-version
git add apps/desktop/package.json
git commit -m "chore: bump desktop release version"
git tag v0.3.2
git push origin main v0.3.2
```

After the tag is pushed, GitHub Actions builds and uploads the release assets.

## References

- GitHub Actions secrets: https://docs.github.com/en/actions/concepts/security/secrets
- Electron code signing: https://www.electronjs.org/docs/latest/tutorial/code-signing
- electron-builder code signing: https://www.electron.build/docs/features/code-signing/
- Apple notarytool credentials: https://developer.apple.com/documentation/technotes/tn3147-migrating-to-the-latest-notarization-tool
