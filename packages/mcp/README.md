# @marlo/mcp

Marlo over the Model Context Protocol. Three tools, all of them read-only.

```bash
pnpm add -D @marlo/mcp
```

```json
{
  "mcpServers": {
    "marlo": { "command": "marlo-mcp" }
  }
}
```

## Why every tool here reads and nothing writes

An MCP server hands capabilities to a model that will call them without a person between the decision and the effect. That is what it is for, and it is why this one cannot write anything.

Marlo's standing promise is that it never merges, never pushes to a default branch, never force pushes, never rewrites history and never deploys. A promise like that is worth exactly what its narrowest surface is worth, so the narrowest surface does not hold the capability. There is no `fix` tool, no `apply` tool, no tool that takes a path and writes to it. `mcp.test.ts` asserts that the package does not so much as import `writeFileSync` or `execSync`.

Ask for a write tool and you get the reason rather than a not-found:

```
marlo_fix → Marlo has no fix tool over MCP, and will not have one. Repair arrives
            as a pull request a person approves, because a tool call has no human
            between the decision and the edit.
```

When the repair layer lands, that stays true. The thing that offers to change your code is a pull request somebody reviews.

## The tools

|                      |                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `marlo_scan_html`    | Check HTML source. Accepts source directly, not only a URL, so a model can ask about a component it has just written. |
| `marlo_explain_rule` | One ACT rule, in both accuracy views, so a model can decide how much to trust a finding before relaying it.           |
| `marlo_coverage`     | The fraction with its denominator, and the measured false positive rate.                                              |

## What makes this different from wrapping axe-core

Two things, and they are both in what the tools return rather than in what they do.

**Every result carries the measured accuracy of the engine that produced it.** `precision 1.00 over 17 official test cases` is a different thing to relay than a bare finding.

**Every response says what was not examined before it says what was found.** A model handed "no violations" will tell its user the page is fine. A model handed "two rules need layout and were not evaluated, this is not a pass" can say that instead, or ask for the browser renderer. Nothing else about the transport matters as much as that ordering.

Every tool description states a limit as well as a capability, for the same reason. A description that only says what a tool does invites a model to over-trust it, and over-trust in an accessibility checker is the default failure this project exists to argue about.

## The transport

JSON-RPC 2.0 over stdio, newline-delimited, hand-written rather than taken from the official SDK. Under a hundred lines for `initialize`, `tools/list` and `tools/call`, and a package whose whole claim is that it cannot write anything should be short enough that somebody can read it and agree.

You can drive it by hand, which is the other reason:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"marlo_coverage"}}' \
  | marlo-mcp
```

`initialize` declares `tools` and nothing else. Declaring a capability the server does not implement would be the MCP equivalent of an option that does nothing, and there is an [entry in HONESTY.md](../../HONESTY.md) about one of those.
