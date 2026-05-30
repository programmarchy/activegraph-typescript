// @activegraph/pack-diligence — the reference Diligence pack.
//
// Skeleton — Phase 6 ports the 8 object types, 7 behaviors, 3 tools, and
// recorded fixtures from python/activegraph/packs/diligence/. The exported
// `diligencePack` is a valid Pack today so the umbrella package can
// re-export it.

import { definePack, type Pack } from "@activegraph/packs";

export const diligencePack: Pack = definePack({
  name: "diligence",
  version: "0.0.0-dev",
  description: "Investment-diligence reference pack (skeleton — full port in Phase 6).",
});
