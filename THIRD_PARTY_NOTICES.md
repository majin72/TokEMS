# Third-Party Notices

TokEMS depends on open-source packages maintained by their respective authors. Each package remains under its own license. The authoritative dependency versions are recorded in `pnpm-lock.yaml`, and installed packages include their license text and attribution files.

The production dependency audit for `v0.1.0` found the following license expressions:

- `0BSD`
- `Apache-2.0` and `Apache License 2.0`
- `BSD-2-Clause` and `BSD-3-Clause`
- `BlueOak-1.0.0`
- `CC-BY-4.0` and `CC0-1.0`
- `ISC`
- `MIT`, `MIT-0`, and dual MIT expressions
- `MPL-2.0` and `(MPL-2.0 OR Apache-2.0)`
- `Python-2.0`
- `(BSD-3-Clause OR GPL-2.0)`

Dependencies with license expressions that commonly need separate review include:

| Package        | Version        | License expression        | Project                                          |
| -------------- | -------------- | ------------------------- | ------------------------------------------------ |
| `caniuse-lite` | `1.0.30001806` | `CC-BY-4.0`               | <https://github.com/browserslist/caniuse-lite>   |
| `dompurify`    | `3.4.12`       | `MPL-2.0 OR Apache-2.0`   | <https://github.com/cure53/DOMPurify>            |
| `lightningcss` | `1.32.0`       | `MPL-2.0`                 | <https://github.com/parcel-bundler/lightningcss> |
| `node-forge`   | `1.4.0`        | `BSD-3-Clause OR GPL-2.0` | <https://github.com/digitalbazaar/forge>         |
| `argparse`     | `2.0.1`        | `Python-2.0`              | <https://github.com/nodeca/argparse>             |

Rebuild the current inventory with:

```bash
pnpm licenses list --prod --json
```

Review this notice and the installed package license files before distributing production images or other binary artifacts.
