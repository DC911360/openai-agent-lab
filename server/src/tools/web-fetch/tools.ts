import type {  WebFetchInput,WebFetchResult   } from "./types.js"
import type { Tool   } from "../too.type.js"

import { webFetch } from "./web-fetch.js"

import { webFetchDefinition } from "./definition.js"

export const webFetchTool: Tool<WebFetchInput, WebFetchResult> = {
    definition: webFetchDefinition,
    execute:webFetch
}