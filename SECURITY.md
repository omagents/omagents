# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Reporting a Vulnerability

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please:

1. Use [GitHub Security Advisories](https://github.com/omagents/omagents/security/advisories/new) to report privately
2. Or email: **security@omagents.dev**
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Affected versions
   - Potential impact
   - Suggested fix (if any)

## Response Timeline

| Severity | First Response | Fix Target |
|----------|---------------|------------|
| Critical | 24 hours | 7 days |
| High | 48 hours | 30 days |
| Medium | 72 hours | 90 days |
| Low | 1 week | Next release |

## Scope

**In scope:**
- Plugin code (`.opencode/plugins/`)
- Python scripts (`skills/`)
- MCP server configurations
- Loop engine (`skills/_shared/scripts/`)

**Not in scope:**
- OpenCode runtime itself (report to [OpenCode](https://github.com/sst/opencode))
- Third-party MCP servers (report to their respective maintainers)
- Superpowers dependency (report to [obra/superpowers](https://github.com/obra/superpowers))

## Disclosure

We follow responsible disclosure. Once a fix is released, we will publish a
GitHub Security Advisory with credit to the reporter (unless they prefer to
remain anonymous).
