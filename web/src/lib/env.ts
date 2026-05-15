export function readRequiredEnv(name: string) {
  return String(import.meta.env[name] ?? '').trim()
}
