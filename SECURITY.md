# Security

Leonida Intelligence is designed to run **only on a private home network**:

- It refuses requests from public IP addresses (unless `LI_ALLOW_PUBLIC_IPS=true`).
- State-changing API calls require a custom request header, which blocks cross-site form posts.
- An optional access PIN (`LI_ACCESS_PIN`) protects the API with a signed HttpOnly cookie.
- It needs no API keys or accounts, and stores no secrets other than a random cookie-signing
  key in `data/secret.key`.

**Please don't expose it to the internet** with port forwarding. If you need remote access, use
a VPN into your home network.

## Reporting a vulnerability

Use **Security → Report a vulnerability** on the GitHub repository page. This sends a private
report to the maintainer.

Please don't open a public issue for security problems. Include the version (commit), your
setup and steps to reproduce.
