# Notice

The files under this directory are a verbatim copy of the ACT-Rules Community
test cases, retrieved from https://act-rules.github.io/testcases.json on 2026-07-29.

They are **not** Marlo's work. They are vendored so that Marlo's calibration
numbers are reproducible offline and cannot change without a reviewed commit.
Nothing here is modified. `MANIFEST.json` records a SHA-256 digest of every
file and `pnpm corpus:verify` fails if any byte differs, which means a local
modification cannot go unmarked.

This directory includes material copied from the ACT-Rules Community rules and
test cases, <https://act-rules.github.io>. Copyright the contributors to the ACT-Rules
Community Group. Licensed under the W3C Software and Document Licence.

## W3C Software And Document Notice And License

This work is being provided by the copyright holders under the following
license.

### License

By obtaining and/or copying this work, you (the licensee) agree that you have
read, understood, and will comply with the following terms and conditions.

Permission to copy, modify, and distribute this work, with or without
modification, for any purpose and without fee or royalty is hereby granted,
provided that you include the following on ALL copies of the work or portions
thereof, including modifications:

- The full text of this NOTICE in a location viewable to users of the
  redistributed or derivative work.
- Any pre-existing intellectual property disclaimers, notices, or terms and
  conditions. If none exist, the W3C Software and Document Short Notice should be
  included.
- Notice of any changes or modifications, through a copyright statement on the
  new code or document such as "This software or document includes material
  copied from or derived from [title and URI of the W3C document]. Copyright
  © [YEAR] W3C® (MIT, ERCIM, Keio, Beihang)."

### Disclaimer

This work is provided "AS IS," and copyright holders make no representations or
warranties, express or implied, including but not limited to, warranties of
merchantability or fitness for any particular purpose or that the use of the
software or document will not infringe any third party patents, copyrights,
trademarks or other rights.

Copyright holders will not be liable for any direct, indirect, special or
consequential damages arising out of any use of the software or document.

The name and trademarks of copyright holders may NOT be used in advertising or
publicity pertaining to the work without specific, written prior permission.
Title to copyright in this work will at all times remain with copyright holders.

## Regenerating

```
pnpm corpus:fetch     # needs network, rewrites this directory
pnpm corpus:verify    # no network, proves nothing was modified
```

A regeneration is a deliberate commit. The diff shows what upstream changed, and
the calibration table is expected to move with it.
