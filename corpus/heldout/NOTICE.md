# Notice

The files under `corpus/heldout/pages/` are snapshots of twenty-five public web pages,
retrieved on 2026-10-20 by `scripts/snapshot-real-pages.mjs --corpus heldout`. They are
**not** Marlo's work. They are vendored so that Marlo's measurements on these pages are
reproducible offline and cannot change without a reviewed commit. `MANIFEST.json` records a
SHA-256 digest and byte count for every page, and `pnpm corpus:verify` fails if any byte
differs.

## Why a second set of real pages

`corpus/real` is where Marlo's errors on real pages were analysed cell by cell, in
`calibration/ERROR-ANALYSIS.md`. A rule corrected after reading that analysis will score
better on those same pages whether or not the correction generalises, so a figure measured
there is in-sample. These pages are the out-of-sample check. They come from sites
`corpus/real` does not use, which `scripts/verify-real-corpus.mjs` enforces, and their ground
truth was rated and committed before any rule change made after the analysis was measured on
them. The commit history shows the order.

## What was changed

Every page is a modified copy, made exactly as the pages in `corpus/real` were, and every
licence below that asks for changes to be marked is answered by this section:

- The page was loaded in Chromium at 1280 by 800 and serialised after its scripts ran, so a
  single-page application's rendered markup is what was kept.
- Every stylesheet the page loaded was fetched and inlined into a `<style>` element in
  cascade order, with `url()` references made absolute.
- Every `<script>` element and every inline event handler attribute was removed. The
  count is in the provenance comment at the top of each file and in `MANIFEST.json`.
- `img`, `source`, `video`, `iframe` and icon URLs were made absolute. No image, font or
  media file is vendored: those keep their own licences and stay on their owners' servers.
- A doctype and a one-line `marlo-snapshot` provenance comment were written at the top.

No text content was edited.

## How pages are identified in published tables

As for `corpus/real`: by category and the first twelve hex digits of the page's SHA-256,
for example `shop (0123456789ab)`, never by site name. The source URL is in `MANIFEST.json`,
`SOURCES.json` and the list below. `corpus/real/NOTICE.md` gives the reason.

## Pages replaced or dropped before vendoring

Ids are stable, so a number missing from the list below was dropped on purpose.

- `search-01` was first snapshotted from a data.gov search for "air quality". Its publisher
  filter listed one federal publisher under an email address built from a person's
  initials. That is personal data, and a measurement corpus has no need of it, so the page
  was re-snapshotted from a search for "wildfire", which lists none, before anything was
  rated.
- `documentation-03` was first snapshotted with its stylesheets broken. The page imports a
  web font through a URL with semicolons inside its query, and the snapshot script ended
  the `@import` rule at the first one: it inlined the fonts and left the rest of the URL as
  stray text that opened a CSS string, so Chromium dropped every rule after the seventh and
  the page rendered almost unstyled. The parser was fixed (`scripts/lib/css-imports.mjs`)
  and the page re-snapshotted, and both raters' answers on the broken copy were discarded
  and the page rated again. No other page in either corpus carried the fault.

## Attribution, per page

- `application-01` (`cc8c4baec1da`), <https://adminlte.io/themes/v4/>. Licence: [MIT](https://github.com/ColorlibHQ/AdminLTE/blob/master/LICENSE). AdminLTE v4 dashboard demo, Copyright (c) 2014-2023 ColorlibHQ, licensed under the MIT License. Modified: stylesheets inlined, scripts removed.
- `application-02` (`937b7bdb3cb2`), <https://coreui.io/demos/bootstrap/5.3/free/>. Licence: [MIT](https://github.com/coreui/coreui-free-bootstrap-admin-template/blob/main/LICENSE). CoreUI Free Bootstrap Admin Template demo, Copyright (c) 2026 creativeLabs Łukasz Holeczek, licensed under the MIT License. Modified: stylesheets inlined, scripts removed.
- `application-03` (`8ffc4fbb79ca`), <https://todomvc.com/examples/react/dist/>. Licence: [MIT](https://github.com/tastejs/todomvc/blob/master/license.md). TodoMVC React example, Copyright (c) Addy Osmani, Sindre Sorhus, Pascal Hartig, Stephen Sawchuk, licensed under the MIT License. Modified: stylesheets inlined, scripts removed.
- `documentation-01` (`c823959fcd56`), <https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax>. Licence: [CC BY 4.0](https://github.com/github/docs/blob/main/LICENSE). "Basic writing and formatting syntax", GitHub Docs, GitHub, Inc. and contributors, licensed under CC BY 4.0 (site code under MIT, see LICENSE-CODE). Modified: stylesheets inlined, scripts removed.
- `documentation-02` (`d35001a75524`), <https://kubernetes.io/docs/concepts/overview/>. Licence: [CC BY 4.0](https://github.com/kubernetes/website/blob/main/LICENSE). "Overview", Kubernetes documentation, (c) The Kubernetes Authors, licensed under CC BY 4.0. Modified: stylesheets inlined, scripts removed.
- `documentation-03` (`bf4ceee67380`), <https://vuejs.org/guide/essentials/forms.html>. Licence: [CC BY 4.0](https://github.com/vuejs/docs/blob/main/LICENSE). "Form Input Bindings", Vue.js documentation, Copyright (c) 2019-present Yuxi (Evan) You and Vue documentation contributors, licensed under CC BY 4.0 (image files excepted; images are not vendored). Modified: stylesheets inlined, scripts removed.
- `documentation-04` (`be333a42cad3`), <https://docs.deno.com/runtime/test/>. Licence: [MIT](https://github.com/denoland/docs/blob/main/LICENSE). "Testing", Deno Docs, Copyright (c) 2018-2024 the Deno authors, licensed under the MIT License. Modified: stylesheets inlined, scripts removed.
- `error-01` (`d89ee06c9755`), <https://www.nps.gov/this-page-does-not-exist.htm>. Licence: [United States government work (17 U.S.C. 105)](https://www.nps.gov/aboutus/disclaimer.htm). National Park Service 404 page. No claim to original U.S. Government works. The NPS Arrowhead is a registered trademark and appears only as part of the page. Modified: stylesheets inlined, scripts removed.
- `form-01` (`8f8d60d6c406`), <https://getbootstrap.com/docs/5.3/examples/checkout/>. Licence: [MIT](https://github.com/twbs/bootstrap/blob/main/LICENSE). Bootstrap checkout example, Copyright (c) 2011-2026 The Bootstrap Authors, code released under the MIT License (documentation under CC BY 3.0). Modified: stylesheets inlined, scripts removed.
- `form-02` (`96bc0eef964f`), <https://designsystem.digital.gov/templates/form-templates/address-form/>. Licence: [Public domain (United States government work) and CC0 1.0](https://github.com/uswds/uswds-site/blob/main/LICENSE.md). "Address form", U.S. Web Design System, General Services Administration. A work of the United States government in the public domain within the United States, with copyright waived worldwide under CC0 1.0. Modified: stylesheets inlined, scripts removed.
- `government-01` (`3bee53602674`), <https://www.weather.gov/>. Licence: [United States government work (17 U.S.C. 105)](https://www.weather.gov/disclaimer). National Weather Service (NOAA) home page. Information on NWS web pages is in the public domain and not subject to copyright protection (17 U.S.C. 403 notice). This modified copy is not official government material and implies no endorsement by NOAA or NWS. Modified: stylesheets inlined, scripts removed.
- `government-02` (`0a76b0494c93`), <https://commission.europa.eu/index_en>. Licence: [CC BY 4.0 (Commission Decision 2011/833/EU)](https://commission.europa.eu/legal-notice_en). © European Union, 1995-2026. European Commission website home page, reused under CC BY 4.0 in accordance with Commission Decision 2011/833/EU. The EU emblem and third-party content are not covered by the licence. Modified: stylesheets inlined, scripts removed.
- `government-03` (`09a11ba4c53a`), <https://www.nps.gov/yell/index.htm>. Licence: [United States government work (17 U.S.C. 105)](https://www.nps.gov/aboutus/disclaimer.htm). Yellowstone National Park home page, National Park Service. No claim to original U.S. Government works. Third-party photographs are not vendored; the NPS Arrowhead is a registered trademark and appears only as part of the page. Modified: stylesheets inlined, scripts removed.
- `landing-01` (`1b54a1f985cd`), <https://www.typescriptlang.org/>. Licence: [CC BY 4.0](https://github.com/microsoft/TypeScript-Website/blob/v2/LICENSE). TypeScript website home page, © Microsoft Corporation, content licensed under CC BY 4.0 and code under the MIT License (LICENSE-CODE). Microsoft trademarks are not licensed. Modified: stylesheets inlined, scripts removed.
- `login-01` (`8c28574c8eaa`), <https://demo.solidus.io/login>. Licence: [BSD 3-Clause](https://github.com/solidusio/solidus_starter_frontend/blob/main/LICENSE). Solidus sample store login page, Copyright (c) 2024 Nebulab SRLs (solidus_starter_frontend) and Copyright (c) 2015-2026 Solidus contributors, licensed under the BSD 3-Clause License. Modified: stylesheets inlined, scripts removed.
- `news-01` (`0292a3d7d86c`), <https://globalvoices.org/2026/10/14/norways-telenor-telecom-faces-lawsuit-for-giving-user-data-to-myanmars-junta/>. Licence: [CC BY 3.0](https://globalvoices.org/about/global-voices-attribution-policy/). This story by Mong Palatino originally appeared on Global Voices on 14 October 2026, licensed under CC BY 3.0. Third-party images are not vendored. Modified: stylesheets inlined, scripts removed.
- `news-02` (`cd50437c3c64`), <https://diff.wikimedia.org/2026/10/19/tech-news-2026-issue-43/>. Licence: [CC BY-SA 4.0](https://diff.wikimedia.org/about/). "Tech News 2026, Issue 43", Diff, Wikimedia Foundation and Tech News writers, licensed under CC BY-SA 4.0. This modified copy is distributed under CC BY-SA 4.0. Modified: stylesheets inlined, scripts removed.
- `news-03` (`35fe3d89afd4`), <https://www.nsf.gov/news/nsf-invests-translating-low-dimensional-semiconductor>. Licence: [United States government work (17 U.S.C. 105)](https://www.nsf.gov/policies/digital). Courtesy: U.S. National Science Foundation. News release text prepared by U.S. government employees and not subject to copyright. The NSF logo is not in the public domain and appears only as part of the page. Modified: stylesheets inlined, scripts removed.
- `search-01` (`6ac0f59a729e`), <https://catalog.data.gov/?q=wildfire&org_type=Federal+Government>. Licence: [United States government work (17 U.S.C. 105)](https://data.gov/privacy-policy/). Data.gov catalog search results, U.S. General Services Administration, filtered to federal publishers. Federal data and content are not subject to domestic copyright protection under 17 U.S.C. 105; the catalog software is CC0 (https://github.com/GSA/data.gov/blob/main/LICENSE.md). Modified: stylesheets inlined, scripts removed.
- `settings-01` (`4ab2647430ec`), <https://zuramai.github.io/mazer/demo/account-security.html>. Licence: [MIT](https://github.com/zuramai/mazer/blob/main/LICENSE). Mazer admin dashboard account security page, Copyright (c) 2021-current Ahmad Saugi, licensed under the MIT License. Modified: stylesheets inlined, scripts removed.
- `shop-01` (`1d1ec8505558`), <https://laravel.demo.aimeos.org/shop/t-shirts~8>. Licence: [LGPL-3.0](https://github.com/aimeos/ai-client-html/blob/master/LICENSE). Aimeos demo shop category listing. HTML client and theme (aimeos/ai-client-html) and demo catalogue (aimeos/aimeos-core, setup/default/data) Copyright Metaways Infosystems GmbH 2014 and Aimeos 2015-2026, licensed under LGPL-3.0; Laravel distribution (aimeos/aimeos) under MIT. Product images are remote and not vendored. Modified: stylesheets inlined, scripts removed.
- `shop-02` (`b47d2166c25a`), <https://laravel.demo.aimeos.org/shop/red-t-shirt>. Licence: [LGPL-3.0](https://github.com/aimeos/ai-client-html/blob/master/LICENSE). Aimeos demo shop product page. HTML client and theme (aimeos/ai-client-html) and demo catalogue (aimeos/aimeos-core, setup/default/data) Copyright Metaways Infosystems GmbH 2014 and Aimeos 2015-2026, licensed under LGPL-3.0; Laravel distribution (aimeos/aimeos) under MIT. Product images are remote and not vendored. Modified: stylesheets inlined, scripts removed.
- `shop-03` (`373ce6879fca`), <https://demo.solidus.io/products/solidus-t-shirt>. Licence: [BSD 3-Clause](https://github.com/solidusio/solidus_starter_frontend/blob/main/LICENSE). Solidus sample store product page, Copyright (c) 2024 Nebulab SRLs (solidus_starter_frontend) and Copyright (c) 2007-2014 Spree Commerce, Inc., 2015-2026 Solidus contributors (sample data, solidusio/solidus sample/), licensed under the BSD 3-Clause License. Modified: stylesheets inlined, scripts removed.
- `shop-04` (`2f27af976502`), <https://demo.solidus.io/cart>. Licence: [BSD 3-Clause](https://github.com/solidusio/solidus_starter_frontend/blob/main/LICENSE). Solidus sample store cart page, Copyright (c) 2024 Nebulab SRLs (solidus_starter_frontend) and Copyright (c) 2015-2026 Solidus contributors, licensed under the BSD 3-Clause License. Modified: stylesheets inlined, scripts removed.
- `table-01` (`d25dbf4e66da`), <https://www.eia.gov/electricity/monthly/epm_table_grapher.php?t=epmt_5_06_a>. Licence: [United States government work (17 U.S.C. 105)](https://www.eia.gov/about/copyrights_reuse.php). Source: U.S. Energy Information Administration, Electric Power Monthly, Table 5.6.A (retrieved October 2026). A U.S. government publication in the public domain. Modified: stylesheets inlined, scripts removed.

## Licences

### Creative Commons

Pages under a Creative Commons licence are redistributed here under that same licence,
which share-alike requires for the CC BY-SA page. The full texts are at:

- CC BY 3.0: <https://creativecommons.org/licenses/by/3.0/legalcode>
- CC BY 4.0: <https://creativecommons.org/licenses/by/4.0/legalcode>
- CC BY-SA 4.0: <https://creativecommons.org/licenses/by-sa/4.0/legalcode>
- CC0 1.0: <https://creativecommons.org/publicdomain/zero/1.0/legalcode>

### European Commission content

Content from the European Commission's website is reused under CC BY 4.0 in accordance with
Commission Decision 2011/833/EU, <https://commission.europa.eu/legal-notice_en>. The EU
emblem and third-party content are not covered and appear only as part of the page.

### United States government works

Pages from weather.gov, nps.gov, nsf.gov, eia.gov, data.gov and the U.S. Web Design System
are works of the United States government and are not subject to copyright in the United
States (17 U.S.C. 105). Logos, insignia and trademarks keep their own restrictions and
appear only as part of the page. These copies are modified, are not official government
material, and imply no endorsement by any agency.

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

### BSD 3-Clause License

The Solidus pages are redistributed under the following terms, with the copyright lines
given in the list above.

```text
Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### GNU Lesser General Public License v3.0

The Aimeos pages are modified copies of output from software licensed under the GNU Lesser
General Public License version 3.0, and are distributed under that licence. Its text is at
<https://www.gnu.org/licenses/lgpl-3.0.txt> and the text of the GNU General Public License
version 3, which it incorporates, at <https://www.gnu.org/licenses/gpl-3.0.txt>. The source
of the software is at <https://github.com/aimeos/ai-client-html> and
<https://github.com/aimeos/aimeos-core>, and the modifications made here are the ones listed
under "What was changed".
