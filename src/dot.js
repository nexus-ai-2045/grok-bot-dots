export function createDotIngress() {
  return {
    describe() {
      return {
        configured: false,
        endpoint: null,
        automatic_wake: false,
        available: false,
        reason:
          "dot ingress is an explicit unconfigured adapter. No dot endpoint is available and nothing is woken.",
      };
    },
    accept() {
      return {
        ok: false,
        code: "dot_ingress_unconfigured",
        httpStatus: 503,
        endpoint: null,
        automatic_wake: false,
      };
    },
  };
}
