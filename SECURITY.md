# Security Policy

## Reporting a vulnerability

Please report security issues privately rather than opening a public issue:

- Use GitHub's **"Report a vulnerability"** button on the Security tab, or
- Open a GitHub advisory draft against this repository.

Include a description, reproduction steps, and affected version/commit. You can expect an initial response within a few days. Please allow reasonable time for a fix before public disclosure.

## Security model

RagUi is designed as a self-hosted application. Keep the following in mind when deploying:

- **Authentication is opt-in.** With `API_AUTH_TOKEN` empty (the default), every API route is open to whoever can reach it — fine on `localhost`, not fine exposed to a network. Set a token for any non-local deployment.
- **API keys live in the browser.** Provider keys (OpenAI, custom endpoints) are stored in the user's localStorage and sent per request; the backend never persists them.
- **Custom base URLs are a trusted-user feature.** The backend will call any http(s) endpoint configured as a provider — that's what makes LM Studio/Ollama-compatible endpoints work. Don't expose an open instance to untrusted users.
- **TLS is not provided out of the box.** Terminate HTTPS at your own reverse proxy or load balancer in front of the nginx profile.

See the "Production hardening checklist" in [README.md](README.md) for deployment guidance.
