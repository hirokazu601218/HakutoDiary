export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return {
      shortCircuit: true,
      url: "data:text/javascript,export const env = globalThis.__TEST_CLOUDFLARE_ENV__ ?? {};",
    };
  }
  return nextResolve(specifier, context);
}
