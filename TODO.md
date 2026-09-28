# TODO

Backlog for OntoLearn Annotator, as of 2026-09-02, merged to `main`.

Every claim below was verified against the running stack, not read off the code. File
references use `path:line`. Start the whole thing locally with `../start-local.sh`.

Suggested order: the remaining `/api/v1` auth hole → file storage (which is the other
half of that hole) → deployment → project members → finishing the `Data`/`DataFile`
migration → node editor → Headwork. Headwork sits last because it is the only item
blocked on a third party whose contract is still undefined.

What was fixed on 2026-09-01 and 2026-09-02 is listed near the bottom — read that first,
it will save re-diagnosing behaviour that has already been explained.

---

## P0 — Security holes

### 1. `/api/v1/*` has no authentication at all

Six routes accept unauthenticated requests: `data`, `tasks`, `sources`, `statistics`,
`playground-tasks`, `data/[id]`; `api/v1/categories` too. No `auth()` call, no API key, no
`Authorization` header check.

Verified: an anonymous `POST /api/v1/projects/<id>/data` created a row and returned it.

These are the routes the ML workers in `examples/` poll — `playground.py`, `upload.py` and
`02_prediction.py` all call them with plain `requests`, no session and no cookie. So a session
cookie is the wrong answer: they need a machine credential (project-scoped API key or service
token), checked in the route and mapped onto an ABAC action. Note this is also what keeps
uploaded files public — see item 2.

### 2. Uploaded files are served publicly with no access control

Covered under [File storage](#3-real-file-storage) below — listed here because the
access-control half is a security bug, not an architecture preference. Bear in mind
`playground.py` fetches `{platformUrl}{filePath}` with no credentials, so locking this down and
item 1 have to land together.

## P1 — Workflow engine: what is still missing

**A loop's own `storeAs` does not accumulate.** Per-step `storeAs` now writes (fixed
2026-09-02), but the loop's own path — meant to hold one entry per iteration, e.g. `qa.details`
— stays `null`, and each iteration overwrites the same step paths (`detail.zone`,
`detail.class`). Every iteration still reaches the database tagged with its `iteration` index,
so this is a context/guard limitation, not loss on save. Implementing it means having
`LoopStateCompiler` push the iteration's slice onto an array on the loop-check transition, and
removing the `state.type === 'loop'` exclusion in `StateCompiler.hasStoreAction` that currently
keeps the generic single-payload assign from half-implementing it.

**A `yes_no` step inside a loop is a dead end.** `LoopStateCompiler.compileLoopStep` compiles
every step generically and wires it to `NEXT`, while `YesNoRenderer` sends `YES`/`NO`, so such a
step can never be answered. Fixing it means delegating to `YesNoStateCompiler` and deciding how
`yesTarget`/`noTarget` resolve to sibling step ids.

**`over:`** (iterate over a collection) is accepted by `LoopStateSchema` but
`LoopStateCompiler` only implements `repeatWhile` — it never reads `over`.

**Action and guard names are a flat namespace.** They are `store_<id>` / `guard_<id>_<i>` with
no parent prefix, while `schema.ts` only checks id uniqueness among *top-level* states. Now that
loop steps are registered too, a step id colliding with a top-level state id silently overwrites
one registration with the other. Either namespace nested names by parent, or validate step-id
uniqueness in `validateWorkflowSemantics`.

**`compiler.ts:initializeDataStructure`** still iterates top-level states only, so a loop step's
`storeAs` path is not pre-seeded to `null`. A `when` reading it before the first write logs a
`console.error` and evaluates false instead of throwing. A one-line traversal swap would fix it,
but it changes the initial shape of `context.data`, so it is a separate decision.

**Only 4 of the 9 task field types render**: `text`, `email`, `number`, `textarea`. `select`,
`slider`, `yes_no` and `area_select` fields validate but render as a bare label, so a required
field of those types leaves Continue permanently disabled.

## Feature work

### 3. Real file storage

Today: synchronous `writeFileSync` into the Next.js `public/` directory, in three places
— `src/actions/data.ts:91`, `src/actions/projects.ts:41`,
`src/server/actions/playground.ts:24`.

Three separate problems:

- **No access control.** Anything under `public/` is served as a static asset, so every
  uploaded image is readable by URL with no session. This is the security half.
- **No horizontal scaling.** Files live on the instance's local disk; a second replica
  cannot see them.
- **Blocking I/O.** `writeFileSync` stalls the Node event loop on every upload.

Target: object storage (S3 or MinIO) behind either signed short-lived URLs or an
`/api/files/[id]` route that goes through ABAC (`data:read`). Needs a migration path for
existing `filePath` values, which are currently `/uploads/...` public paths.

### 4. Deployment

The multi-stage Dockerfile builds a Next standalone image and is broadly correct. Two
hard blockers:

- `Dockerfile` does `COPY --from=builder /app/.env.local ./.env` — this **bakes secrets
  into the image**, and the build fails outright without a `.env.local`, which is
  gitignored. The build is therefore neither reproducible nor safe to publish. Env should
  be injected at runtime.
- Base image is `node:18-alpine`; Node 18 has been end-of-life since April 2025.

Also missing: CI pipeline, container healthcheck, a migration step at deploy time, TLS
and a reverse proxy (`docker-compose.yml` maps both 80 and 443 to the same plain port
3000). And ABAC_NII is a runtime dependency — the deployment story has to cover two
services plus two databases, not one.

### 5. UX / navigation

- **An ABAC denial renders as a 404.** `fetchProjectBySlug`
  (`src/services/projects.ts:83`) returns `null` on a failed `project:read`, and the page
  calls `notFound()`. A project you are a member of but lack rights on is
  indistinguishable from one that does not exist. It should be an explicit
  "access denied" screen.

### 6. Project members can only be viewed, not managed

`/projects/{slug}/settings/users` lists the members and nothing else. There is no way to
invite someone, change a role or remove a member — so a project is stuck with whoever
created it, and the only way to add people today is an `INSERT` into `ProjectMember`
(whose `id` has no database default, so raw SQL has to supply a cuid).

Everything underneath is ready and unused: the `Role` enum is `ADMIN | USER`, the policy
distinguishes them (ADMIN may do anything, USER may read/list plus write on `task` and
`playground`), and `user:invite`, `user:delete` and `user:edit` already exist in
`abac-action-categories.ts` with no code behind them.

What is missing: the mutations themselves, guarded with `requireWrite(projectId, "user")`
or the matching action, plus an invitation path for someone who has no account yet — the
email provider is already wired, so a magic-link invite is the natural fit.

Related, and worth deciding at the same time: nothing stops the last ADMIN from
demoting or removing themselves.

### 7. Finish replacing `Data` with `DataFile`

`main` has only `Data`; commit `5d4c709` added `DataFile` beside it and the `Data` model
is byte-identical to what it was on `main` — never deprecated, never removed. So the
replacement was started and left half-done, and the split of consumers shows exactly
where it stopped:

- **`DataFile`** (under a `Source`): the UI upload, both annotation pages, the
  annotations table, `/api/workflow/save` — everything written on this branch.
- **`Data`** (under the project): `/api/v1/projects/[id]/data` and `/api/v1/data/[id]`
  — everything that predates it. The dashboard read it too, until 2026-09-02.

That `DataFile.destination` defaults to `ML` is the giveaway: it was meant to absorb the
ML path as well.

Two things make the rest non-trivial, which is presumably why it stalled:

1. `DataFile` requires a `sourceId` and a unique `filePath`, while
   `POST /api/v1/.../data` creates a row with inline `content` and no source. Porting it
   means deciding which `Source` a machine upload attaches to, and inline content has no
   equivalent on disk.
2. That endpoint is live: `examples/water_crystal_classification/02_upload/upload.py:108`
   posts to it, so removing `Data` breaks the ML upload client. Note the same script
   already reads and updates `Source` rows through `/api/v1/.../sources` — the parent of
   `DataFile` — so the two halves are closer than they look.

Once ported: update `upload.py`, then drop the `Data` model and `DataType` in a
migration.

This item has been resolved on 09/28/2026 via the PLAN-upload-pipeline-storage.md

### 8. Node-based workflow editor instead of YAML

Current state of the two halves:

- The **real** editor is a YAML textarea at `/projects/{slug}/settings/annotations`, with
  working Load / Validate / Save against `/api/projects/{slug}/config/annotation_workflow`.
  The workflow is stored as a YAML string in `Configuration.settings.workflow`, keyed by
  `(projectId, type="annotation_workflow")`.
- `FlowBuilder` (`src/app/_components/task/flow-builder/flow-builder.tsx`, 450 lines,
  `@xyflow/react`) is mounted at `/projects/{slug}/settings/tasks` but is a **static
  mock**: `initialNodes` is hardcoded, there is no fetch and no save, and its node model
  (`taskNode` with typed `flow`/`image` ports) does not match the engine's schema.

Recommendation: keep YAML as the **storage** format and make the graph a bidirectional
view over it, rather than replacing the format. The Zod schema in
`src/lib/workflow-engine/schema.ts` already defines the full contract, so:

- YAML → graph is the easy direction (parse, lay out, render).
- Graph → YAML is where the work is: loops (nested `steps`), `branch` guard ordering,
  `storeAs` paths, and the two `yes_no` wiring forms (`yesTarget`/`noTarget` vs
  `transitions`).

Two engine gaps to close first, or the editor will offer nodes that do not work:

- `over:` (iterate over a collection) is accepted by `LoopStateSchema` but **not
  implemented** — `LoopStateCompiler` only handles `repeatWhile`.
- Only 4 of the 9 schema field types render in a `task` state (`text`, `email`,
  `number`, `textarea`). `select`, `slider`, `yes_no` and `area_select` fields validate
  but render as a bare label.

### 9. Headwork integration

Effectively unstarted. What exists: the `DataFileDestination.HEADWORK` and
`AuthorType.HEADWORK` enum values, a few validation schemas, and `amqplib` as a
dependency that is **never imported anywhere**.

Everything is still to be specified before any code: transport (AMQP?), task exchange
format, annotation mapping in both directions, and whether we push or Headwork pulls.

---

## Fixed on 2026-09-01 and 2026-09-02 — context for the handover

Do not re-diagnose these; they are done and verified. Listed because the reasoning is
easy to lose and two of them were caused by upstream behaviour, not by our code.

- **`middleware.ts` now exists.** The `authorized()` callback in `auth.ts` had never run —
  in NextAuth v5 it only fires from middleware — so a signed-out visitor reached the page
  and `protectedProcedure` threw an unhandled `UNAUTHORIZED` (and `/projects` returned
  500). Because middleware runs on the Edge, where Prisma and nodemailer cannot, the
  config is split: `src/server/auth.config.ts` holds the Edge-safe slice (`session`,
  `pages`, `authorized`) and `auth.ts` spreads it. Protected pages now redirect to `/`.
  The old "logged-in visitor bounces to /projects" branch was dropped, otherwise the
  landing page is unreachable once signed in.
- **Email login used to fail with `MissingCSRF` on a cold first visit.** `login/page.tsx`
  read the `authjs.csrf-token` cookie, but `/login` never sets it — only an
  `/api/auth/*` route does. The form now goes through the `signIn()` server action, like
  the OAuth buttons.
- **`verify-request` is now a real page** (`/login/verify-request`). Note
  `pages.verifyRequest` **does not work**: `@auth/core`'s `send-token.js:68` hardcodes
  the redirect. The sign-in action calls `signIn(..., { redirect: false })` and redirects
  itself.
- **Browser language detection was broken for every real browser.** The old code compared
  raw `Accept-Language` entries (`fr-FR`, `fr;q=0.9`) against `['en','fr','ja']`, so only
  a bare `fr` matched. `src/lib/accept-language.ts` now parses properly, with 9 tests.
- **The language choice did not persist.** `setUserLocale` set a session cookie, and the
  settings form used `mutate` (fire-and-forget) so the database write was never awaited —
  the UI could switch language while the account kept the old one, and the next sign-in
  silently reverted it. Cookie is now persistent (1 year); the form awaits `mutateAsync`.
- **Polygon areas rendered as "Invalid coordinates"** in the read-only history: the
  polygon tool emits `[x, y]` tuples (also what is stored in `AreaOfInterest.area`) while
  the renderer only accepted `{x, y}` objects. Four tests cover both shapes.
- **Classes were never attached for any workflow but the water-crystal one.**
  `extractClassesFromPayload` was hardcoded to that workflow's storeAs paths. A leaf
  value is now treated as a class when the project declares it as a ClassType — which
  also means a class-bearing `choice` must read `source: <class types>` rather than
  inline demo values, or it silently links nothing.
- **`POST /api/workflow/save` accepted writes to any project.** It checked a session and that
  `userId` matched it, then looked the data file up by id alone and resolved `ClassType`s from the
  client-supplied `projectId` — so any logged-in user could annotate another project's file and
  enumerate its vocabulary. Now behind `requireWrite(projectId, "task")`, with the data file
  scoped through its `Source`, and the per-group writes in a transaction so a mid-way failure
  cannot leave orphan `AreaOfInterest` rows.
- **The workflow `validate` route had no authentication at all** — it ran the YAML parser and the
  whole compiler on anonymous input. Gated like its GET/POST siblings, which had been fixed a day
  earlier while this third handler was missed.
- **Three project pages had no permission check.** `annotations/page.tsx`,
  `annotations/[dataFileId]/page.tsx` and `playground/page.tsx` each did their own bare
  `prisma.project.findUnique({ where: { slug } })`, so a logged-in non-member reached them. They
  now go through `fetchProject` like every other project page.
- **Class-vocabulary reads were open to any session** through three paths (`GET class-types`,
  `GET classes`, tRPC `getClassTypes`), returning a private project's classes and usage counts to
  any logged-in user. All three now require a read permission; `classes` uses `task:read` because
  `DataSourceLoader` fetches it from the browser mid-annotation. `?status=` is validated instead
  of cast, so a bad value is a 400 rather than a Prisma 500.
- **`visibility` was retired.** It never had a read path, and the create form hardcoded
  `visibility: "public"` while discarding the radio selection — so once the binding was fixed the
  day before, *every* project created through the UI was stored `PUBLIC` while non-members still
  got a 404. The two schemas also disagreed on case (`zod.ts` uppercase, the tRPC input
  lowercase), which is why the hardcode existed. The field is gone from both schemas, the
  mutation and the form; the column keeps its `PRIVATE` default, so restoring the feature is a
  reversible decision — see item 5.
- **`storeAs` and `when` did nothing on a loop step.** `ActionCompiler.compile` and
  `GuardCompiler.compile` iterated only `workflow.workflow.states`, while a loop keeps its
  children in `state.steps`. A `when` there did not merely no-op: XState raised
  "Guard 'guard_<id>_<i>' is not implemented" and the actor died with `status: 'error'`, which
  looks like a frozen state path. Both compilers now walk a shared `StateTraversal`, and
  `compileLoopStep` attaches the store action last so it lands on `NEXT` and `AREA_SELECTED`
  alike. `hasStoreAction` now excludes `yes_no` (whose actions are `store_<id>_yes`/`_no`) and
  `loop` (whose `storeAs` means accumulation, still unimplemented) so neither is silently
  attached to a no-op.
- **The workflow settings page could persist an invalid workflow.** `handleSave` awaited
  `handleValidate()` then read `validationResult`, a render behind, so the first click saved
  broken YAML and a later fixed one was refused. `handleValidate` now returns its result.
- **`POST /api/projects/[slug]/config/[type]` accepted anonymous calls** while
  rewriting a project's entire annotation workflow. Both handlers now require a session
  plus `settings:read` / `settings:write` — verified: anonymous 401, `USER` 200 on GET
  and 403 on POST, `ADMIN` 200.
- **`storeAs` wrote nothing for `task` and `area_select`.**
  `addStoreActionsToTransitions` gated on `state.storeAs`, which a task state cannot
  have (`TaskStateSchema` is strict), so the action ActionCompiler built from its fields
  was never attached; and `AreaSelectStateCompiler` never called that method at all, so
  no guard could branch on a selected area. Both now write, covered by tests that assert
  on `context.data` rather than on the state path.
- **An answer given before any area selection is no longer dropped.**
  `Annotation.areaOfInterestId` is nullable (migration
  `20260902094350_annotation_optional_area`) and `groupAnnotationsByContext` opens an
  image-level group for choices met before the first area. Such an annotation is saved
  with no `AreaOfInterest`; the annotations table already skipped AOI-less rows, so it
  renders unchanged. A group without an area also no longer becomes the parent of a
  following sub-section.
- **A `USER` could redefine the project's class vocabulary, and the page offered it.** The three writing
  class-types routes only checked for a session, so any member could create, rename or
  delete a class type. They now go through `requireWrite(projectId, "settings")`, which
  the policy grants to `ADMIN` only — verified: `USER` gets 403 on POST/PATCH/DELETE and
  200 on GET, `ADMIN` gets 201. The settings page was also split into a server wrapper
  that resolves `settings:write` and a client component that greys out Add / Edit /
  Delete and the status badge, the same shape as the users and integrations pages.
- **A project description longer than 191 characters returned a raw 500.**
  `createProjectInputSchema` allows 10 000 while the column was Prisma's default
  `VARCHAR(191)`. Now `@db.Text` (migration `20260902082659_project_description_text`).
- **`visibility` was accepted then dropped**, so every project came out `PRIVATE`
  whatever the user picked. `project.create` now maps `"public"`/`"private"` onto the
  enum.
- **The dashboard read the wrong data model.** "Data" and "Recent Data" counted `Data`
  while UI uploads land in `DataFile`, so a project with files showed 0 and "No data
  available"; "Annotated Data" was a hardcoded `0.0`. All three now read `DataFile`
  through its `Source`, and the row download target moved from `/datasets/{projectId}/
  {content}` — a route that does not exist and 404'd — to the served `filePath`.
  Accuracy and the chart are unchanged: those genuinely are ML-fed, from the `Statistics`
  table. Also dropped an unused monthly-count query, a duplicate
  `fetchHeaderStatistics` call in the Recent Data card, and a
  `setTimeout(10)` labelled "Simulate long running operation".
- **The landing page had no way in.** The "Get Started" button's `href` was commented out
  in favour of `href="#"` plus an onClick, and the `isLogged` prop was unused. There is
  now a Login/Projects button in the header and a real `href`.

---

## Notes for whoever picks this up

- **OPA does not watch its policy file.** It loads `policy.rego` once at startup, so
  `docker compose restart opa` is required after editing it.
- **The annotator caches ABAC decisions in-process** for `ABAC_CACHE_TTL` (3600s), so a
  policy fix does not take effect in a running dev server — restart it.
- **A stale `ABAC_SERVER_URL` looks exactly like a permission denial.** `checkPermission`
  fails closed on a fetch error, logging only `ECONNREFUSED`.
- **`branch` states are not auto-transitioning in the machine.** They only accept `NEXT`;
  the renderer sends it after a ~500ms routing message. Driving a machine in a test
  without that `NEXT` desynchronises every later event by one and produces misleading
  "stored in the wrong field" results.
- Event names the UI sends (`workflow-annotator.tsx:543` → `actor.send({type, data})`):
  `NEXT` for task/choice/multi_choice, `AREA_SELECTED` for area_select, `YES`/`NO` for
  yes_no and loop checks.
