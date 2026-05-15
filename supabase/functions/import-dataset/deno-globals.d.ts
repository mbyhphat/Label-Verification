/** Editor-only Deno globals (see tsconfig.json; not used by Deno CLI). */
declare namespace Deno {
  function serve(
    handler: (request: Request) => Response | Promise<Response>,
  ): void

  namespace env {
    function get(key: string): string | undefined
  }
}
