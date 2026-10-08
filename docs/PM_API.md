# Scripting `pm.*` compatibility

Scripts run in a hardened worker. There is no `require`, `process`, `fs`, or Electron access. `eval` / `new Function` are disabled.

## Supported

| API | Support | Notes |
| --- | --- | --- |
| `pm.test(name, fn)` | Yes | Failures recorded, do not throw out of the suite |
| `pm.expect(value)` | Subset | `to.eql`, `to.equal`, `to.deep.equal`, `to.be.ok`, `to.be.true`, `to.be.false`, `to.be.null`, `to.be.undefined`, `to.have.property`, `to.include`, `to.be.a`/`an`, `to.have.length`, `below`/`above`, `to.have.status` via `pm.response.to.have.status` |
| `pm.response.code` / `.status` / `.responseTime` / `.headers` / `.text()` / `.json()` | Yes | |
| `pm.response.to.have.status` | Yes | |
| `pm.response.to.have.jsonSchema(schema)` | Yes | Ajv 2020 |
| `pm.request.url` / `.method` / `.headers` | Yes | |
| `pm.environment.get/set/unset/has` | Yes | |
| `pm.collectionVariables.*` | Yes | |
| `pm.globals.*` | Yes | |
| `pm.variables.get` | Yes | Resolved precedence |
| `pm.iterationData.get` | Yes | Runner only |
| `pm.info.eventName` / `.iteration` / `.iterationCount` / `.requestName` | Yes | |
| `pm.sendRequest(url\|spec, cb)` | Bounded | Max 3 nested; no file access |
| `pm.execution.skipRequest()` | Yes | Pre-request |
| `console.log/warn/error/info` | Yes | Capped |
| `setTimeout` | Bounded | Cleared at end of script |

## Unsupported in v0.1 (reported if used)

`pm.require`, `pm.visualizer`, `pm.vault`, `pm.cookies.jar` mutation beyond in-memory, `pm.gzip`, external `lodash`/`moment`/`crypto-js` packages, `pm.execution.setNextRequest` (tracked phase 4 — currently a recorded no-op with a warning).

Imported scripts are stored and never executed during import or preview.
