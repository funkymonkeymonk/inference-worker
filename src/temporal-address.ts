export function temporalAddressFromEnvironment(environment: NodeJS.ProcessEnv = process.env): string {
  return environment.TEMPORAL_ADDRESS ?? `127.0.0.1:${environment.TEMPORAL_PORT ?? "7233"}`;
}
