# Two images out of one file: `--target server` and `--target web`.
# Alpine keeps the runtime layer small; the bun version matches CI (ADR 0014).
FROM oven/bun:1.3.14-alpine AS base
WORKDIR /app

# Manifests only, so a source edit does not re-run the install.
# `--ignore-scripts`: the root `prepare` installs git hooks and patches
# typescript for `@effect/tsgo`, neither of which exists in an image.
FROM base AS manifests
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/api/package.json packages/api/
COPY packages/ui/package.json packages/ui/

FROM manifests AS deps
RUN bun install --frozen-lockfile --ignore-scripts

# What the server image runs, and nothing else. Three things are needed to get
# there, because bun installs the whole workspace set from the lockfile
# otherwise: drop the web and ui workspaces, drop the devDependencies (`-p`
# only drops the root's, and drizzle-kit alone is 95MB), and drop the lockfile,
# which would otherwise reinstate all of it. Every server dependency is pinned
# to an exact version, so only transitive versions float here — that is the
# price of a runtime image a third of the size.
# `--linker hoisted`: the isolated default extracts every package into a shared
# store next to the symlinks, and the store is what makes the layer big.
# The prune drops what only a type-checker or a debugger reads: declarations,
# sourcemaps and the `src/` trees packages ship beside `dist/`. It is two thirds
# of the tree. Nothing here resolves a runtime entry to a raw `.ts` — the ones
# that list one (better-auth, zod) put it behind a `dev-source` condition bun
# never enables, and `@xsblx/api`, which does need its sources, is a symlink out
# of `node_modules` to `/app/packages/api`, which `find` does not follow.
FROM manifests AS prod-deps
RUN rm -rf bun.lock apps/web packages/ui \
  && bun -e 'const f="apps/server/package.json",p=require("./"+f);delete p.devDependencies;require("fs").writeFileSync(f,JSON.stringify(p))' \
  && bun install --ignore-scripts --production --linker hoisted \
  && find node_modules -type f \
       \( -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' -o -name '*.map' \) -delete \
  && find node_modules -mindepth 2 -maxdepth 3 -type d -name src -exec rm -rf {} + \
  && find node_modules -type f \( -name '*.md' -o -name 'LICENSE*' \) -delete


FROM base AS server
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules node_modules
COPY packages/api packages/api
COPY apps/server apps/server
EXPOSE 3000
CMD ["bun", "apps/server/src/index.ts"]


FROM deps AS web-build
# Baked into the client bundle at build time, so it cannot come from the
# container environment — it has to be a build argument.
ARG VITE_API_URL=http://localhost:3000
COPY . .
RUN bun run --filter web build

# Nitro's `.output` is self-contained (ADR 0013), so the runtime image carries
# no node_modules at all.
FROM base AS web
ENV NODE_ENV=production
COPY --from=web-build /app/apps/web/.output .output
EXPOSE 3001
CMD ["bun", ".output/server/index.mjs"]
