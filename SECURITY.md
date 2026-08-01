# Security Policy

## Supported versions

TokEMS is currently in private preview. Security fixes are applied to the latest commit on `main`. A formal supported-version table will be published with the first public release.

## Report a vulnerability

Please do not open a public issue for a suspected vulnerability.

Use GitHub's private vulnerability reporting for the TokEMS repository. If that option is unavailable, contact `@yaojingang` through a private contact method listed on the maintainer's GitHub profile.

Include the following information when possible:

- The affected component and version or commit.
- Steps to reproduce the issue.
- The expected and observed behavior.
- The likely impact and attack prerequisites.
- Any suggested mitigation.

The maintainer aims to acknowledge complete reports within three business days. Remediation timing depends on severity, exploitability, and the availability of a safe fix. Please allow time for a patch before public disclosure.

## Scope

Reports about authentication, organization isolation, payment callbacks, ticket access, file access, template execution, encrypted integration credentials, and production configuration are especially useful.

Demo credentials, fixed verification codes, and payment simulation are intentional local-only features. A report is still valid if production mode can enable or expose one of these features.

## Safe harbor

Good-faith research that avoids privacy violations, data destruction, service disruption, and unauthorized persistence is welcome. Stop testing and report the issue if you encounter real user data or gain access beyond the minimum needed to demonstrate the vulnerability.
