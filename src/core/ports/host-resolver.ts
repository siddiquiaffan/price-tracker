/** Resolves a hostname to its IP addresses. Used to defeat DNS-rebinding SSRF. */
export interface HostResolver {
  resolve(hostname: string): Promise<string[]>;
}
