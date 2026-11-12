# Connect chat to A1 Scout

Start from your chat app's connector settings. Scout asks you to link this browser using an expiring phone code, then explicitly allow or deny the named client access to the connected workspace.

The `scout:chat` permission lets that client read your work profile and log short signal names and integer counts. Never approve an unfamiliar client or redirect destination. Consent expires after ten minutes and can only be used once.

Live logging is an optional model-reported summary when you ask, not automatic chat history collection or guaranteed device-local processing. Prompts, replies, titles, paths, URLs, emails and secrets are rejected. Use [export import](/connect/import/) for deterministic parsing on your own device.
