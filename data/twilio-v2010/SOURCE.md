# Source: Twilio REST API v2010 (OpenAPI)

| Field | Value |
|---|---|
| Repository | https://github.com/twilio/twilio-oai |
| File | `spec/json/twilio_api_v2010.json` |
| Commit | `218b7821602a93ae63e83e20ab5e8637e870250f` (2026-09-28) |
| URL at commit | https://github.com/twilio/twilio-oai/blob/218b7821602a93ae63e83e20ab5e8637e870250f/spec/json/twilio_api_v2010.json |
| sha256 | `78e76cc93c355a259e241866c241663eddb6ce0ed528f066c6cf0958648f5637` |
| Size | 1,878,531 bytes |
| Retrieved | 2026-09-29 |
| Repository license | MIT (per the GitHub API for `twilio/twilio-oai`) |
| Spec `info.license` | Apache 2.0 |

Both licenses are permissive. Both notices are in [`NOTICE`](../../NOTICE).

## Counts (from `catalog.json`, computed by `npm run build-catalog`)

- 197 operations (GET 103, POST 62, DELETE 32; no PUT or PATCH)
- 22 path families (first literal segment after `/2010-04-01/Accounts/{AccountSid}/`; account-level operations go to `Accounts`)
- 75 spec tags (shown in tooltips only)
- 47 operations with no `description` and no `summary`
- No duplicate `operationId`s

## Reproduce

```bash
npm run fetch-spec        # downloads the file at the pinned commit, refuses on hash mismatch
npm run build-catalog     # writes data/twilio-v2010/catalog.json
```

The 1.9 MB spec is not committed. Only the derived `catalog.json` is.

Crosstalk is not affiliated with Twilio. No Twilio logos are used.
