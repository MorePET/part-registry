// Plugin registry. Open/Closed: drop a plugin file in this folder
// and register it here.

import type { Plugin } from "../core/types";
import { errorReportPlugin } from "./error-report";
import { themePlugin } from "./theme";

export const PLUGINS: Plugin[] = [themePlugin, errorReportPlugin];
