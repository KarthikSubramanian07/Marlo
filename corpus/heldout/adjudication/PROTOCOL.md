# Adjudication protocol for the held-out pages

The ground truth for `corpus/heldout` is produced under exactly the protocol in
[`corpus/real/adjudication/PROTOCOL.md`](../../real/adjudication/PROTOCOL.md): one cell is one
page by one rule Marlo implements, four answers with a note required for `failed` and
`cantTell`, two independent raters on deterministic shuffled worksheets, the same mechanical
pre-screen, Cohen's kappa over the rated cells, a third party resolving every disagreement,
and `resolve` refusing to overrule two raters who agreed. Every command takes
`--corpus heldout`:

```sh
node scripts/adjudicate.mjs sheet --rater A --corpus heldout
node scripts/adjudicate.mjs agreement --corpus heldout
node scripts/adjudicate.mjs resolve --corpus heldout
```

## What is different, and why

**The order of work is part of the protocol.** These pages exist to measure rule changes
made after the error analysis on `corpus/real`, so their value depends on nobody having
seen how those changes score on them. The pages, both worksheets, the resolutions and
`resolved.json` were committed, together with the engines' measurement under the rules as
they stood, before any such change was measured here. A change merged later can be checked
against this record, and the commit history shows the order.

**The sites are disjoint.** No page comes from a site `corpus/real` uses, and
`scripts/verify-real-corpus.mjs` fails if one does, so a rule written around one site's
markup cannot score here for that reason.

**The raters are the same.** Rater A was `claude-opus-5-5`, rater B `claude-sonnet-5-5`, and
the resolver `claude-fable-5-1`, under the same instructions, tools and prohibitions as for
`corpus/real` (described under "Model raters" in that protocol): blind to every engine,
working from the page snapshot and the normative text of each ACT rule at commit
`40fd79067532ef9ee2af50e36384a725c3157ee8`, with no accessibility checker run or consulted.
How accurate this process is on cases with a known answer is measured in
[`corpus/real/adjudication/RATER-VALIDITY.md`](../../real/adjudication/RATER-VALIDITY.md),
and that measurement applies here unchanged because nothing about the raters changed.

This is **model-adjudicated ground truth, not human judgment**, and every figure that rests
on it says so.
