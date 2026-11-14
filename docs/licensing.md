# License choice and redistribution

DengAgent is distributed under **MIT**. This is a permissive choice aligned with Pi's license and a small reusable developer tool. It permits commercial use and closed-source derivatives subject to preserving its copyright and permission notice. It does not require downstream modifications to be published.

The installed `@earendil-works/pi-agent-core`, `pi-ai` and `pi-telemetry` 1.3.0 manifests declare MIT. Their official repository's `v1.3.0` LICENSE names Mario Zechner (2025). Pi's own license is independent of whichever compatible license Deng chooses. [Pi LICENSE](https://github.com/earendil-works/pi/blob/v1.3.0/LICENSE) · [OSI MIT text](https://opensource.org/license/mit)

**Apache-2.0** is another permissive commercial option with an explicit contributor patent grant and patent-termination provisions, plus more detailed redistribution/notice requirements. Prefer it if those provisions are a project priority. It also allows closed-source derivatives. [Official Apache-2.0 text](https://www.apache.org/licenses/LICENSE-2.0) · [Apache license FAQ](https://www.apache.org/foundation/license-faq.html)

If the intended policy instead requires derivatives to remain open source, MIT and Apache-2.0 do not implement that policy. That would need a separate copyleft decision and compatibility review. The repository’s [LICENSE](../LICENSE) states the terms applied to the published source; dependency licenses remain independent.

## Dependency scope

`licenses/dependencies.json` inventories every package location/version in this lockfile and checks installed version/license metadata. The current set contains MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, Unlicense and 0BSD declarations. No copyleft declaration appears in that set. This metadata/text review is not a source-level authorship audit, legal opinion or guarantee about all possible future dependency versions.

`npm run licenses` copies distributed legal texts, extracts the MIT section embedded in data-uri-to-buffer's README, and supplements missing legal files from recorded upstream sources. `licenses/upstream/sources.json` records those sources and checksums, including any provenance limitations. Root/subdirectory licenses must be checked separately: Standard Webhooks' JavaScript library is under `libraries/LICENSE` (MIT), while its repository root is Apache-2.0.

Third-party licenses remain attached to those components; Deng's MIT file does not relicense them. Retain dependency copyrights, permission texts and applicable NOTICE files when distributing copies. The standalone Node runtime has its own extensive LICENSE and bundled component notices, shipped at `runtime/LICENSE`. Updating dependencies or the runtime requires another inventory and notice review.
