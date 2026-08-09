import { getRuntimeConfig } from "../config/io.js";

export type GatewayModelChoice = import("../agents/model-catalog.js").ModelCatalogEntry;
export type GatewayModelCatalogSnapshot =
  import("../agents/model-catalog.js").ModelCatalogSnapshot;

type GatewayModelCatalogConfig = ReturnType<typeof getRuntimeConfig>;
type LoadModelCatalog = (params: {
  config: GatewayModelCatalogConfig;
  readOnly?: boolean;
}) => Promise<GatewayModelChoice[]>;
type LoadModelCatalogSnapshot = (params: {
  config: GatewayModelCatalogConfig;
  readOnly?: boolean;
}) => Promise<GatewayModelCatalogSnapshot>;
type LoadGatewayModelCatalogParams = {
  getConfig?: () => GatewayModelCatalogConfig;
  loadModelCatalog?: LoadModelCatalog;
  loadModelCatalogSnapshot?: LoadModelCatalogSnapshot;
  readOnly?: boolean;
};

type GatewayModelCatalogCache = {
  lastSuccessfulCatalog: GatewayModelCatalogSnapshot | null;
  inFlightRefresh: Promise<GatewayModelCatalogSnapshot> | null;
  staleGeneration: number;
  appliedGeneration: number;
};

function createGatewayModelCatalogCache(): GatewayModelCatalogCache {
  return {
    lastSuccessfulCatalog: null,
    inFlightRefresh: null,
    staleGeneration: 0,
    appliedGeneration: 0,
  };
}

const readOnlyModelCatalogCache = createGatewayModelCatalogCache();
const fullModelCatalogCache = createGatewayModelCatalogCache();

function resolveGatewayModelCatalogCache(
  params?: LoadGatewayModelCatalogParams,
): GatewayModelCatalogCache {
  return params?.readOnly === false ? fullModelCatalogCache : readOnlyModelCatalogCache;
}

function resetGatewayModelCatalogState(): void {
  for (const cache of [readOnlyModelCatalogCache, fullModelCatalogCache]) {
    cache.lastSuccessfulCatalog = null;
    cache.inFlightRefresh = null;
    cache.staleGeneration = 0;
    cache.appliedGeneration = 0;
  }
}

function isGatewayModelCatalogStale(cache: GatewayModelCatalogCache): boolean {
  return cache.appliedGeneration < cache.staleGeneration;
}

async function resolveLoadModelCatalog(
  params?: LoadGatewayModelCatalogParams,
): Promise<LoadModelCatalogSnapshot> {
  if (params?.loadModelCatalogSnapshot) {
    return params.loadModelCatalogSnapshot;
  }
  if (params?.loadModelCatalog) {
    const legacyLoadModelCatalog = params.loadModelCatalog;
    return async (loadParams) => ({
      models: await legacyLoadModelCatalog(loadParams),
      complete: true,
      source: "provider-discovery",
    });
  }
  const { loadModelCatalogSnapshot } = await import("../agents/model-catalog.js");
  return loadModelCatalogSnapshot;
}

function startGatewayModelCatalogRefresh(
  params?: LoadGatewayModelCatalogParams,
): Promise<GatewayModelCatalogSnapshot> {
  const cache = resolveGatewayModelCatalogCache(params);
  const config = (params?.getConfig ?? getRuntimeConfig)();
  const readOnly = params?.readOnly !== false;
  const refreshGeneration = cache.staleGeneration;
  const refresh = resolveLoadModelCatalog(params)
    .then((loadModelCatalog) => loadModelCatalog({ config, readOnly }))
    .then((snapshot) => {
      if (
        (readOnly || (snapshot.complete && snapshot.models.length > 0)) &&
        refreshGeneration === cache.staleGeneration
      ) {
        cache.lastSuccessfulCatalog = snapshot;
        cache.appliedGeneration = cache.staleGeneration;
      }
      return snapshot;
    })
    .finally(() => {
      if (cache.inFlightRefresh === refresh) {
        cache.inFlightRefresh = null;
      }
    });
  cache.inFlightRefresh = refresh;
  return refresh;
}

export function markGatewayModelCatalogStaleForReload(): void {
  readOnlyModelCatalogCache.staleGeneration += 1;
  fullModelCatalogCache.staleGeneration += 1;
}

// Test-only escape hatch: model catalog is cached at module scope for the
// process lifetime, which is fine for the real gateway daemon, but makes
// isolated unit tests harder. Keep this intentionally obscure.
export async function __resetModelCatalogCacheForTest(): Promise<void> {
  resetGatewayModelCatalogState();
  const { resetModelCatalogCacheForTest } = await import("../agents/model-catalog.js");
  resetModelCatalogCacheForTest();
}

export async function loadGatewayModelCatalog(
  params?: LoadGatewayModelCatalogParams,
): Promise<GatewayModelChoice[]> {
  return (await loadGatewayModelCatalogSnapshot(params)).models;
}

export async function loadGatewayModelCatalogSnapshot(
  params?: LoadGatewayModelCatalogParams,
): Promise<GatewayModelCatalogSnapshot> {
  const cache = resolveGatewayModelCatalogCache(params);
  const isStale = isGatewayModelCatalogStale(cache);
  if (!isStale && cache.lastSuccessfulCatalog !== null) {
    return cache.lastSuccessfulCatalog;
  }
  if (isStale && cache.lastSuccessfulCatalog !== null) {
    if (!cache.inFlightRefresh) {
      void startGatewayModelCatalogRefresh(params).catch(() => undefined);
    }
    return cache.lastSuccessfulCatalog;
  }
  if (cache.inFlightRefresh) {
    return await cache.inFlightRefresh;
  }
  return await startGatewayModelCatalogRefresh(params);
}
