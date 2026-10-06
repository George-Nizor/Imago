import { realApi } from "./client.js";
import type { Api } from "./types.js";

export const isMock = new URLSearchParams(location.search).has("mock") || import.meta.env.VITE_IMAGO_MOCK === "1";
// The mock is loaded on demand, so a normal build never runs it.
export const api: Api = isMock ? (await import("./mock.js")).mockApi : realApi;
