# Imago MCP dependency audit — 2026-08-21

This is a dated package-manager result for the local MCP server. It is not a permanent claim about
future lockfiles.

## Reproduction

The audit ran from a clean WSL archive of the repository:

```bash
cd mcp
npm ci
npm audit --omit=dev --json
```

The MCP build and both package/runtime tests passed in the same archive.

## Result

`npm audit --omit=dev` reported four production advisories: one moderate and three high.

| Package | Route | Audit finding |
| --- | --- | --- |
| `@imgly/background-removal-node` | direct | high umbrella finding through Lodash, Sharp, and Zod; no complete fix available |
| `lodash <=4.17.23` | transitive | code-injection and prototype-pollution advisories |
| `sharp <0.35.0` | transitive | inherited libvips advisories |
| `zod <=3.22.2` | transitive | denial-of-service advisory |

Relevant advisory records:

- [Lodash template imports](https://github.com/advisories/GHSA-r5fr-rjxr-66jc)
- [Lodash path prototype pollution](https://github.com/advisories/GHSA-f23m-r3pf-42rh)
- [Sharp/libvips](https://github.com/advisories/GHSA-f88m-g3jw-g9cj)
- [Zod regular-expression denial of service](https://github.com/advisories/GHSA-m95q-7qp3-xv42)

## Current boundary

Imago MCP is a local stdio process. Its paths are explicit, exports are confined, and it is not
exposed as a network service. Those boundaries reduce exposure; they do not delete a vulnerable
dependency from disk.

Do not publish the MCP package as a cleared public runtime while this result is unresolved. Do not run
`npm audit fix --force` and hope for character development. Review an upstream
`@imgly/background-removal-node` release, update the lockfile deliberately, then rerun the image,
package-inventory, editable-workflow, and production-bundle tests.
