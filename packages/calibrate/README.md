# @trymarlo/calibrate

The harness that measures every engine against the official ACT test cases, and separately against the real pages in `corpus/real`, and writes the calibration table every confidence figure Marlo prints comes from.

Every engine goes through the same code path: no engine gets a longer timeout, a retry, a different renderer or a special case, and Marlo's own engine is one of the four with no exemption. The reason is in [DECISIONS.md](../../DECISIONS.md#d-008).

## Why it is published

The CLI depends on it for `MarloEngine`, the wrapper that runs Marlo's rules through the same interface as axe-core, Alfa and HTML CodeSniffer, and for the browser bundle of those rules. Installing `@trymarlo/cli` installs this package for that reason alone.

The `marlo-calibrate` command needs the vendored corpus, which is not in the package, so it runs from a checkout:

```sh
git clone https://github.com/KarthikSubramanian07/Marlo && cd Marlo
pnpm install && pnpm calibrate
```

The table it writes, and how to read it, is described in [calibration/README.md](../../calibration/README.md).
