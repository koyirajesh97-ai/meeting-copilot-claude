interface ImportMetaEnv {
  /** Sentry DSN baked in at build time (MAIN_VITE_SENTRY_DSN); empty means no crash reports. */
  readonly MAIN_VITE_SENTRY_DSN?: string;
  /** OTLP/HTTP collector for request traces (MAIN_VITE_OTEL_ENDPOINT), used only with diagnostics on. */
  readonly MAIN_VITE_OTEL_ENDPOINT?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
