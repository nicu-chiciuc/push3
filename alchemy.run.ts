// The Alchemy stack of this site, in the shape of samebase/base. .github/workflows/alchemy.yml runs
// it through the shared samebase/samebase deploy workflow: the stage `prod` on each push to main,
// and the stage `pr-<number>` on each pull request, a Worker of its own that `alchemy destroy`
// deletes when the pull request closes. `prod` also serves push.tsx.md, a custom domain in the
// tsx.md zone of the same Cloudflare account; previews stay on workers.dev.
//
// The site is static. The workflow builds dist/ before the deploy (`npm run typecheck && npm run
// build`), and the Worker serves it as assets. The page talks to the Push from the browser (Web MIDI
// for pads and LEDs, WebUSB for the screen), so the Worker runs no code of its own.
//
// The stack name is the repository. Its state is in the `alchemy-state-store` project of the Convex
// team of the credential: the team token CONVEX_ACCESS_TOKEN in CI. The Worker needs
// CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Convex from "@samebase/alchemy-convex";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
  "nicu-chiciuc/push3-twin",
  {
    providers: Cloudflare.providers(),
    state: Convex.withRunRecord(Convex.state()),
  },
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    const site = yield* Cloudflare.Worker("Site", {
      name: stage === "prod" ? "push3-twin" : `push3-twin-${stage}`,
      domain: stage === "prod" ? "push.tsx.md" : undefined,
      assets: { directory: "./dist", notFoundHandling: "single-page-application" },
      compatibility: { date: "2026-11-01" },
      workersDev: { enabled: true, previewsEnabled: true },
    }).pipe(Alchemy.RemovalPolicy.retain(stage === "prod"));

    return { url: site.url };
  }),
);
