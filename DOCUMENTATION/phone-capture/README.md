# Phone chat capture verification

All screenshots use synthetic fixtures, never account exports or user evidence. Captured in Playwright WebKit using `devices['iPhone 15']`; import and landing layouts also checked at 375 CSS pixels. Screenshots were visually inspected for readable preview fields, gutters and overflow.

- [Claude export preview](claude-iphone-preview.png)
- [ChatGPT export preview](chatgpt-iphone-preview.png)
- [Phone chats card](phone-card-iphone.png)
- [Browser linking](link-iphone.png)
- [Privacy page](privacy-iphone.png)

## Reproduce

```sh
npm run build
npm test
npx playwright test
SCOUT_PREVIEW_URL=https://bab716bc-a1-scout-docs.jordan-691.workers.dev npx playwright test test/browser/phone.spec.mjs test/browser/site.spec.mjs
npx wrangler deploy --dry-run
```

The preview browser suite mocks profile/evidence endpoints and uses synthetic exports. It checks live static assets, local parsing, OAuth discovery and unauthenticated MCP without creating remote workspaces or uploading evidence. The full local suite additionally runs the OAuth consent/PKCE/token/replay flow against local workerd.

Root tests: 15 passed. Connector tests: 15 passed. Local browser checks: 8 passed. Preview browser checks: 7 passed. Browser modules and the upstream collector/rules copies match byte-for-byte. The packaged connector is 0.3.0; the copied collector preserves its upstream internal version.

The additive D1 links migration is applied. Worker version `bab716bc-fbbe-4e24-819b-28cd3314ed78` is uploaded for preview only. Production deployment waits for PR merge. Real Claude web/iPhone connector verification remains pending; ChatGPT phone support is to verify. Live summaries are model-reported, not guaranteed device-local parsing. GTM is unconfigured in this deployment; count-only tracking is tested with a mocked test-only configuration.
