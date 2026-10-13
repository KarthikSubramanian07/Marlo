# Notice

The files under `corpus/real/pages/` are snapshots of twenty-five public web pages,
retrieved on 2026-10-12 by `scripts/snapshot-real-pages.mjs`. They are **not** Marlo's work.
They are vendored so that Marlo's measurements on real pages are reproducible offline and
cannot change without a reviewed commit. `MANIFEST.json` records a SHA-256 digest and byte
count for every page, and `pnpm corpus:verify` fails if any byte differs.

## What was changed

Every page is a modified copy, and every licence below that asks for changes to be marked
is answered by this section. The same changes were made to every page:

- The page was loaded in Chromium at 1280 by 800 and serialised after its scripts ran, so a
  single-page application's rendered markup is what was kept.
- Every stylesheet the page loaded was fetched and inlined into a `<style>` element in
  cascade order, with `url()` references made absolute. A stylesheet that could not be
  fetched is replaced by a CSS comment saying so.
- Every `<script>` element and every inline event handler attribute was removed. The
  count is in the provenance comment at the top of each file and in `MANIFEST.json`.
- `img`, `source`, `video`, `iframe` and icon URLs were made absolute. No image, font or
  media file is vendored: those keep their own licences and stay on their owners' servers.
- A doctype and a one-line `marlo-snapshot` provenance comment were written at the top.

No text content was edited.

## How pages are identified in published tables

Published tables, `calibration/table.json` and `calibration/README.md` included, name a
page by its category and the first twelve hex digits of its SHA-256, for example
`government (85fa82766479)`. The source URL for each page is in `MANIFEST.json`,
`SOURCES.json` and the list below, so nothing is hidden from anyone who wants to check.

The reason is courtesy rather than licence. Every licence here would permit naming the
site. But a page somebody wrote is being used to measure accessibility engines, not to
grade its authors, and a table of findings keyed by a site name reads as a ranking of
sites. A digest also names the exact bytes measured, which a URL cannot: the live page
will have changed by the time anyone reads the table.

## Pages dropped before vendoring

Ids are stable, so five numbers are missing on purpose.

- `government-03` (the European Union country list) was dropped because nine of its
  stylesheets, all served from the EU web tools host, refused the snapshot with HTTP 403.
  The kept copy would have rendered a cookie consent banner without its styling, which is
  a page no visitor sees.
- `news-03` (a NASA news release) was dropped because it publishes the names and
  direct email addresses of two named press officers. That is personal data, and a
  measurement corpus has no need of it.
- `application-04` (the AdminLTE dashboard), `form-03` (the AdminLTE form elements page)
  and `form-04` (the Tabler form elements page) were dropped because they hang engines
  under happy-dom. On each, neither axe-core nor HTML CodeSniffer finished within ten
  minutes, and HTML CodeSniffer on the AdminLTE dashboard, run with no cap at all, took
  1,249 seconds of wall time for one evaluation. All three inline more than 790 KiB of
  CSS over more than 1,100 elements. The timings were taken on a shared machine under heavy
  load, so they overstate what an idle machine would take, but these three were the only
  pages on which any engine failed to finish at all. A page that cannot be measured in bounded time cannot
  be measured the same way for every engine, so it is not in the corpus.

## Attribution, per page

- `government-01` (`85fa82766479`), <https://www.usa.gov/>. Licence: [United States government work (17 U.S.C. 105)](https://www.usa.gov/government-copyright). USA.gov, U.S. General Services Administration. A work of the United States government, not subject to copyright in the United States.
- `government-02` (`ab2ca3d5ac91`), <https://www.gov.uk/>. Licence: [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/). Contains public sector information licensed under the Open Government Licence v3.0.
- `government-04` (`2b6bea051603`), <https://www.nasa.gov/>. Licence: [United States government work (NASA media usage guidelines)](https://www.nasa.gov/nasa-brand-center/images-and-media/). NASA. NASA content is generally not subject to copyright in the United States. The NASA insignia and logotype are not in the public domain and are not used here beyond their appearance in the page.
- `documentation-01` (`7487de8b9f8f`), <https://docs.python.org/3/tutorial/introduction.html>. Licence: [Python Software Foundation License Version 2](https://docs.python.org/3/license.html). Copyright 2001 Python Software Foundation; All Rights Reserved. Derived from the Python documentation under the PSF License Version 2. Changes: stylesheets inlined, scripts removed.
- `documentation-02` (`39f95cc80c20`), <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/img>. Licence: [CC BY-SA 2.5](https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Attrib_copyright_license). "<img>: The Image Embed element" by Mozilla Contributors, licensed under CC BY-SA 2.5. Modified: stylesheets inlined, scripts removed.
- `documentation-03` (`9364dcbac87f`), <https://doc.rust-lang.org/book/ch01-01-installation.html>. Licence: [MIT](https://github.com/rust-lang/book/blob/main/LICENSE-MIT). Copyright (c) 2010 The Rust Project Developers. The Rust Programming Language, dual licensed MIT or Apache 2.0; vendored here under MIT.
- `documentation-04` (`ada6b8fb59cd`), <https://react.dev/learn>. Licence: [CC BY 4.0](https://github.com/reactjs/react.dev/blob/main/LICENSE-DOCS.md). React documentation, Meta Platforms, Inc. and affiliates, licensed under CC BY 4.0. Modified: stylesheets inlined, scripts removed.
- `news-01` (`1266362a16c3`), <https://en.wikipedia.org/wiki/Web_accessibility>. Licence: [CC BY-SA 4.0](https://en.wikipedia.org/wiki/Wikipedia:Copyrights). "Web accessibility", Wikipedia contributors, licensed under CC BY-SA 4.0. Modified: stylesheets inlined, scripts removed. Images are not vendored and carry their own licences.
- `news-02` (`68833e124745`), <https://en.wikinews.org/wiki/Wikimedia_Foundation_closes_Wikinews_after_21_years>. Licence: [CC BY 4.0](https://en.wikinews.org/wiki/Wikinews:Copyright). Wikinews, licensed under CC BY 4.0 (text published after 16 December 2024). Modified: stylesheets inlined, scripts removed.
- `news-04` (`2181a194c04c`), <https://www.gov.uk/government/news/new-taskforce-to-boost-britains-resilience-to-flooding-and-drought>. Licence: [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/). Contains public sector information licensed under the Open Government Licence v3.0.
- `shop-01` (`b640eddff8aa`), <https://next.medusajs.com/us/store>. Licence: [MIT](https://github.com/medusajs/nextjs-starter-medusa/blob/main/LICENSE). Copyright (c) 2022 Medusa. The Medusa Next.js starter storefront demo, MIT licensed.
- `shop-02` (`b049aafa903b`), <https://next.medusajs.com/us/products/espresso-cup>. Licence: [MIT](https://github.com/medusajs/nextjs-starter-medusa/blob/main/LICENSE). Copyright (c) 2022 Medusa. The Medusa Next.js starter storefront demo, MIT licensed.
- `shop-03` (`db52c72978e7`), <https://v2.demo.sylius.com/en_US/taxons/t-shirts/men>. Licence: [MIT](https://github.com/Sylius/Sylius/blob/2.0/LICENSE). Copyright (c) 2011-present Sylius Sp. z o.o. The Sylius Community Edition demo storefront, MIT licensed.
- `shop-04` (`e59fc248b2aa`), <https://v2.demo.sylius.com/en_US/checkout/address>. Licence: [MIT](https://github.com/Sylius/Sylius/blob/2.0/LICENSE). Copyright (c) 2011-present Sylius Sp. z o.o. The Sylius Community Edition demo storefront, MIT licensed. The checkout was reached by adding one product to an empty cart.
- `application-01` (`140e297c3fb9`), <https://demo.realworld.show/>. Licence: [MIT](https://github.com/gothinkster/angular-realworld-example-app/blob/main/LICENSE). RealWorld example app (Conduit), Angular implementation, Copyright (c) Thinkster, MIT licensed. Demo seed content belongs to the RealWorld project.
- `application-02` (`339528b65ae8`), <https://demo.realworld.show/article/how-to-learn-javascript-efficiently>. Licence: [MIT](https://github.com/gothinkster/angular-realworld-example-app/blob/main/LICENSE). RealWorld example app (Conduit), Angular implementation, Copyright (c) Thinkster, MIT licensed. Article content is RealWorld demo seed data.
- `application-03` (`29d051888ee8`), <https://preview.tabler.io/>. Licence: [MIT](https://github.com/tabler/tabler/blob/dev/LICENSE). Copyright (c) 2018-2026 The Tabler Authors. Tabler demo, MIT licensed.
- `form-01` (`85435b63bf0a`), <https://design-system.service.gov.uk/patterns/question-pages/default/index.html>. Licence: [MIT](https://github.com/alphagov/govuk-design-system/blob/main/LICENSE.txt). Crown copyright, GOV.UK Design System, MIT licensed code; content under the Open Government Licence v3.0.
- `form-02` (`312802aff8cc`), <https://design-system.service.gov.uk/patterns/check-answers/default/index.html>. Licence: [MIT](https://github.com/alphagov/govuk-design-system/blob/main/LICENSE.txt). Crown copyright, GOV.UK Design System, MIT licensed code; content under the Open Government Licence v3.0.
- `table-01` (`fb91db770f63`), <https://en.wikipedia.org/wiki/List_of_countries_and_dependencies_by_population>. Licence: [CC BY-SA 4.0](https://en.wikipedia.org/wiki/Wikipedia:Copyrights). "List of countries and dependencies by population", Wikipedia contributors, licensed under CC BY-SA 4.0. Modified: stylesheets inlined, scripts removed. Images are not vendored and carry their own licences.
- `login-01` (`3b077de399e3`), <https://preview.tabler.io/sign-in.html>. Licence: [MIT](https://github.com/tabler/tabler/blob/dev/LICENSE). Copyright (c) 2018-2026 The Tabler Authors. Tabler demo, MIT licensed.
- `settings-01` (`45fd35c19415`), <https://preview.tabler.io/settings.html>. Licence: [MIT](https://github.com/tabler/tabler/blob/dev/LICENSE). Copyright (c) 2018-2026 The Tabler Authors. Tabler demo, MIT licensed.
- `search-01` (`e15f0aeca205`), <https://www.gov.uk/search/all?keywords=passport>. Licence: [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/). Contains public sector information licensed under the Open Government Licence v3.0.
- `error-01` (`8776911cf683`), <https://www.gov.uk/404>. Licence: [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/). Contains public sector information licensed under the Open Government Licence v3.0.
- `landing-01` (`6f9ab4a5a615`), <https://nodejs.org/en>. Licence: [MIT](https://github.com/nodejs/nodejs.org/blob/main/LICENSE). Copyright Node.js Website WG contributors. nodejs.org, MIT licensed. Node.js is a trademark of the OpenJS Foundation.

Where a page is a demo of an MIT licensed project (Tabler, the Medusa starter
storefront, Sylius, the RealWorld Angular app, the GOV.UK Design System, nodejs.org and
the Rust book), the names, products and articles in it are the project's own seed data.

## Licences

### Creative Commons

Pages under a Creative Commons licence are redistributed here under that same licence,
which share-alike requires for the CC BY-SA pages. The full texts are at:

- CC BY 4.0: <https://creativecommons.org/licenses/by/4.0/legalcode>
- CC BY-SA 4.0: <https://creativecommons.org/licenses/by-sa/4.0/legalcode>
- CC BY-SA 2.5: <https://creativecommons.org/licenses/by-sa/2.5/legalcode>

### Open Government Licence v3.0

Contains public sector information licensed under the Open Government Licence v3.0,
<https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/>.

### United States government works

Pages from USA.gov and NASA are works of the United States government and are not subject
to copyright in the United States (17 U.S.C. 105). Logos and insignia keep their own
restrictions and appear only as part of the page.

### MIT License

The MIT licensed pages are redistributed under the following terms, with the copyright
line for each given in the list above.

```text
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Python Software Foundation License Version 2

`documentation-01` is derived from the Python documentation. Copyright 2001 Python
Software Foundation; All Rights Reserved. The summary of changes the licence asks for is
the "What was changed" section above.

```text
PYTHON SOFTWARE FOUNDATION LICENSE VERSION 2
1. This LICENSE AGREEMENT is between the Python Software Foundation ("PSF"), and
   the Individual or Organization ("Licensee") accessing and otherwise using this
   software ("Python") in source or binary form and its associated documentation.

2. Subject to the terms and conditions of this License Agreement, PSF hereby
   grants Licensee a nonexclusive, royalty-free, world-wide license to reproduce,
   analyze, test, perform and/or display publicly, prepare derivative works,
   distribute, and otherwise use Python alone or in any derivative
   version, provided, however, that PSF's License Agreement and PSF's notice of
   copyright, i.e., "Copyright © 2001 Python Software Foundation; All Rights
   Reserved" are retained in Python alone or in any derivative version
   prepared by Licensee.

3. In the event Licensee prepares a derivative work that is based on or
   incorporates Python or any part thereof, and wants to make the
   derivative work available to others as provided herein, then Licensee hereby
   agrees to include in any such work a brief summary of the changes made to Python.

4. PSF is making Python available to Licensee on an "AS IS" basis.
   PSF MAKES NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR IMPLIED.  BY WAY OF
   EXAMPLE, BUT NOT LIMITATION, PSF MAKES NO AND DISCLAIMS ANY REPRESENTATION OR
   WARRANTY OF MERCHANTABILITY OR FITNESS FOR ANY PARTICULAR PURPOSE OR THAT THE
   USE OF PYTHON WILL NOT INFRINGE ANY THIRD PARTY RIGHTS.

5. PSF SHALL NOT BE LIABLE TO LICENSEE OR ANY OTHER USERS OF PYTHON
   FOR ANY INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES OR LOSS AS A RESULT OF
   MODIFYING, DISTRIBUTING, OR OTHERWISE USING PYTHON, OR ANY DERIVATIVE
   THEREOF, EVEN IF ADVISED OF THE POSSIBILITY THEREOF.

6. This License Agreement will automatically terminate upon a material breach of
   its terms and conditions.

7. Nothing in this License Agreement shall be deemed to create any relationship
   of agency, partnership, or joint venture between PSF and Licensee.  This License
   Agreement does not grant permission to use PSF trademarks or trade name in a
   trademark sense to endorse or promote products or services of Licensee, or any
   third party.

8. By copying, installing or otherwise using Python, Licensee agrees
   to be bound by the terms and conditions of this License Agreement.
```
