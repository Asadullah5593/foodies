import axios from "axios";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001/api";

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15_000,
});

export function withPlatformHeaders(headers?: Record<string, string>) {
  return {
    ...(headers ?? {}),
    "x-client-platform": "web",
  };
}

export function toImageUrl(pathOrUrl?: string | null) {
  if (!pathOrUrl) return "";
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return pathOrUrl;
  }

  const base = API_BASE_URL.endsWith("/api")
    ? API_BASE_URL.slice(0, -4)
    : API_BASE_URL;
  return `${base}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;
}
