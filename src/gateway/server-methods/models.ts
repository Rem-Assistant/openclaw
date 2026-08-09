import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { DEFAULT_PROVIDER } from "../../agents/defaults.js";
import { resolveVisibleModelCatalog } from "../../agents/model-catalog-visibility.js";
import { parseConfiguredModelVisibilityEntries } from "../../agents/model-selection-shared.js";
import { resolveDefaultAgentWorkspaceDir } from "../../agents/workspace.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateModelsListParams,
} from "../protocol/index.js";
import type { GatewayRequestContext } from "./shared-types.js";
import type { GatewayRequestHandlers } from "./types.js";

type ModelsListView = "default" | "configured" | "all";
type GatewayModelCatalog = Awaited<ReturnType<GatewayRequestContext["loadGatewayModelCatalog"]>>;
type ModelsListCatalogSource = "gateway-catalog" | "configured-fallback";
type ModelsListCatalogLoad = {
  catalog: GatewayModelCatalog;
  complete: boolean;
  source: ModelsListCatalogSource;
};

const MODELS_LIST_CATALOG_TIMEOUT_MS = 750;
let loggedSlowModelsListCatalog = false;

function resolveModelsListView(params: Record<string, unknown>): ModelsListView {
  return typeof params.view === "string" ? (params.view as ModelsListView) : "default";
}

async function loadModelsListCatalog(
  context: GatewayRequestContext,
  view: ModelsListView,
  cfg: OpenClawConfig,
): Promise<ModelsListCatalogLoad> {
  if (view === "all") {
    return {
      catalog: await context.loadGatewayModelCatalog({ readOnly: false }),
      complete: true,
      source: "gateway-catalog",
    };
  }
  if (parseConfiguredModelVisibilityEntries({ cfg }).providerWildcards.size > 0) {
    return {
      catalog: await context.loadGatewayModelCatalog({ readOnly: false }),
      complete: true,
      source: "gateway-catalog",
    };
  }
  let timeout: NodeJS.Timeout | undefined;
  const timedOut = Symbol("models-list-catalog-timeout");
  const catalogPromise = context.loadGatewayModelCatalog({ readOnly: true });
  const timeoutPromise = new Promise<typeof timedOut>((resolve) => {
    timeout = setTimeout(() => resolve(timedOut), MODELS_LIST_CATALOG_TIMEOUT_MS);
    timeout.unref?.();
  });
  try {
    const result = await Promise.race([catalogPromise, timeoutPromise]);
    if (result === timedOut) {
      catalogPromise.catch(() => undefined);
      if (!loggedSlowModelsListCatalog) {
        loggedSlowModelsListCatalog = true;
        context.logGateway.debug(
          `models.list continuing without model catalog after ${MODELS_LIST_CATALOG_TIMEOUT_MS}ms`,
        );
      }
      return { catalog: [], complete: false, source: "configured-fallback" };
    }
    return { catalog: result, complete: true, source: "gateway-catalog" };
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export const modelsHandlers: GatewayRequestHandlers = {
  "models.list": async ({ params, respond, context }) => {
    if (!validateModelsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.list params: ${formatValidationErrors(validateModelsListParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const cfg = context.getRuntimeConfig();
      const workspaceDir =
        resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg)) ??
        resolveDefaultAgentWorkspaceDir();
      const view = resolveModelsListView(params);
      const catalogLoad = await loadModelsListCatalog(context, view, cfg);
      const catalogMetadata = {
        catalogComplete: catalogLoad.complete,
        catalogSource: catalogLoad.source,
      };
      if (view === "all") {
        respond(true, { models: catalogLoad.catalog, ...catalogMetadata }, undefined);
        return;
      }
      const models = resolveVisibleModelCatalog({
        cfg,
        catalog: catalogLoad.catalog,
        defaultProvider: DEFAULT_PROVIDER,
        workspaceDir,
        view,
        runtimeAuthDiscovery: false,
      });
      respond(true, { models, ...catalogMetadata }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};
