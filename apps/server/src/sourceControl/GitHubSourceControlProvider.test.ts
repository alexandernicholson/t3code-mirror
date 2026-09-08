import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitHubCli from "./GitHubCli.ts";
import { parseGitHubAuthStatus } from "./gitHubAuthStatus.ts";
import * as GitHubSourceControlProvider from "./GitHubSourceControlProvider.ts";

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const processResult = (
  stdout: string,
  options?: {
    readonly stderr?: string;
    readonly exitCode?: ChildProcessSpawner.ExitCode;
  },
): VcsProcess.VcsProcessOutput => ({
  exitCode: options?.exitCode ?? ChildProcessSpawner.ExitCode(0),
  stdout,
  stderr: options?.stderr ?? "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

function makeProvider(github: Partial<GitHubCli.GitHubCli["Service"]>) {
  return GitHubSourceControlProvider.make.pipe(
    Effect.provide(Layer.mock(GitHubCli.GitHubCli)(github)),
  );
}

it.effect("maps GitHub PR summaries into provider-neutral change requests", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      getPullRequest: () =>
        Effect.succeed({
          number: 42,
          title: "Add GitHub provider",
          url: "https://github.com/pingdotgg/t3code/pull/42",
          baseRefName: "main",
          headRefName: "feature/source-control",
          state: "open",
          isCrossRepository: true,
          headRepositoryNameWithOwner: "fork/t3code",
          headRepositoryOwnerLogin: "fork",
        }),
    });

    const changeRequest = yield* provider.getChangeRequest({
      cwd: "/repo",
      reference: "42",
    });

    assert.deepStrictEqual(changeRequest, {
      provider: "github",
      number: 42,
      title: "Add GitHub provider",
      url: "https://github.com/pingdotgg/t3code/pull/42",
      baseRefName: "main",
      headRefName: "feature/source-control",
      state: "open",
      closedAt: null,
      mergedAt: null,
      updatedAt: Option.none(),
      isCrossRepository: true,
      headRepositoryNameWithOwner: "fork/t3code",
      headRepositoryOwnerLogin: "fork",
    });
  }),
);

it.effect("adds safe request context while retaining GitHub CLI causes", () =>
  Effect.gen(function* () {
    const cause = new GitHubCli.GitHubPullRequestNotFoundError({
      command: "gh",
      cwd: "/repo",
      cause: new Error("raw upstream detail that should remain in the cause"),
    });
    const provider = yield* makeProvider({
      getPullRequest: () => Effect.fail(cause),
    });

    const error = yield* provider
      .getChangeRequest({
        cwd: "/repo",
        reference: "https://user:secret@github.com/pingdotgg/t3code/pull/42?token=secret#diff",
      })
      .pipe(Effect.flip);

    assert.deepStrictEqual(
      {
        provider: error.provider,
        operation: error.operation,
        command: error.command,
        cwd: error.cwd,
        reference: error.reference,
        detail: error.detail,
      },
      {
        provider: "github",
        operation: "getChangeRequest",
        command: "gh",
        cwd: "/repo",
        reference: "https://github.com/pingdotgg/t3code/pull/42",
        detail: "Pull request not found. Check the PR number or URL and try again.",
      },
    );
    assert.strictEqual(error.cause, cause);
    assert.equal(error.message.includes("raw upstream detail"), false);
  }),
);

it.effect("uses gh json listing for non-open change request state queries", () =>
  Effect.gen(function* () {
    let executeArgs: ReadonlyArray<string> = [];
    const provider = yield* makeProvider({
      execute: (input) => {
        executeArgs = input.args;
        return Effect.succeed(
          processResult(
            JSON.stringify([
              {
                number: 7,
                title: "Merged work",
                url: "https://github.com/pingdotgg/t3code/pull/7",
                baseRefName: "main",
                headRefName: "feature/merged",
                state: "merged",
                mergedAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-01-02T00:00:00.000Z",
              },
            ]),
          ),
        );
      },
    });

    const changeRequests = yield* provider.listChangeRequests({
      cwd: "/repo",
      headSelector: "feature/merged",
      state: "all",
      limit: 10,
    });

    assert.deepStrictEqual(executeArgs, [
      "pr",
      "list",
      "--head",
      "feature/merged",
      "--state",
      "all",
      "--limit",
      "10",
      "--json",
      "number,title,url,baseRefName,headRefName,state,isDraft,mergedAt,closedAt,updatedAt,isCrossRepository,headRepository,headRepositoryOwner",
    ]);
    assert.strictEqual(changeRequests[0]?.provider, "github");
    assert.strictEqual(changeRequests[0]?.state, "merged");
    assert.strictEqual(changeRequests[0]?.mergedAt, "2026-01-01T00:00:00Z");
    assert.deepStrictEqual(
      changeRequests[0]?.updatedAt,
      Option.some(DateTime.makeUnsafe("2026-01-02T00:00:00.000Z")),
    );
  }),
);

it.effect("treats empty non-open change request listing output as no results", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      execute: () => Effect.succeed(processResult("")),
    });

    const changeRequests = yield* provider.listChangeRequests({
      cwd: "/repo",
      headSelector: "feature/empty",
      state: "all",
      limit: 10,
    });

    assert.deepStrictEqual(changeRequests, []);
  }),
);

it.effect("creates and finds a fork PR in the bound remote rather than gh's upstream default", () =>
  Effect.gen(function* () {
    const fork = "github.com/my-org/project";
    const upstream = "github.com/upstream/project";
    const created = new Map<string, object>();
    const provider = yield* GitHubSourceControlProvider.make.pipe(
      Effect.provide(
        GitHubCli.layer.pipe(
          Layer.provide(
            Layer.mock(VcsProcess.VcsProcess)({
              run: (input) => {
                const repositoryIndex = input.args.indexOf("--repo");
                const repository =
                  repositoryIndex === -1 ? upstream : input.args[repositoryIndex + 1]!;
                if (input.args[0] === "repo" && input.args[1] === "view") {
                  return Effect.succeed(
                    processResult(input.args[2] === fork ? "fork-main\n" : "upstream-main\n"),
                  );
                }
                if (input.args[0] === "pr" && input.args[1] === "create") {
                  created.set(repository, {
                    number: 42,
                    title: "Scoped PR",
                    url: `https://${repository}/pull/42`,
                    baseRefName: "fork-main",
                    headRefName: "feature/settings",
                    state: "OPEN",
                    mergedAt: null,
                    isCrossRepository: false,
                  });
                  return Effect.succeed(processResult(""));
                }
                if (input.args[0] === "pr" && input.args[1] === "list") {
                  const request = created.get(repository);
                  return encodeJson(request ? [request] : []).pipe(
                    Effect.map(processResult),
                    Effect.orDie,
                  );
                }
                if (input.args[0] === "pr" && input.args[1] === "view") {
                  return encodeJson(created.get(repository)).pipe(
                    Effect.map(processResult),
                    Effect.orDie,
                  );
                }
                return Effect.die("Unexpected GitHub command in repository-targeting regression");
              },
            }),
          ),
        ),
      ),
    );
    const context = {
      provider: { kind: "github" as const, name: "GitHub", baseUrl: "https://github.com" },
      remoteName: "origin",
      remoteUrl: "git@github.com:my-org/project.git",
    };
    const baseRefName = yield* provider.getDefaultBranch({ cwd: "/repo", context });
    assert.equal(baseRefName, "fork-main");
    yield* provider.createChangeRequest({
      cwd: "/repo",
      context,
      baseRefName: baseRefName!,
      headSelector: "feature/settings",
      title: "Scoped PR",
      bodyFile: "/tmp/body.md",
    });
    assert.isFalse(created.has(upstream), "must not create a PR in gh's implicit upstream");
    for (const state of ["open", "all"] as const) {
      const requests = yield* provider.listChangeRequests({
        cwd: "/repo",
        context,
        headSelector: "feature/settings",
        state,
      });
      assert.deepEqual(
        requests.map((request) => request.url),
        ["https://github.com/my-org/project/pull/42"],
      );
    }
    const request = yield* provider.getChangeRequest({ cwd: "/repo", context, reference: "42" });
    assert.equal(request.url, "https://github.com/my-org/project/pull/42");
  }),
);

it.effect("targets a selected enterprise remote without forwarding URL credentials", () =>
  Effect.gen(function* () {
    let destination: string | undefined;
    const provider = yield* GitHubSourceControlProvider.make.pipe(
      Effect.provide(
        GitHubCli.layer.pipe(
          Layer.provide(
            Layer.mock(VcsProcess.VcsProcess)({
              run: ({ args }) => {
                destination = args[args.indexOf("--repo") + 1];
                return Effect.succeed(processResult(""));
              },
            }),
          ),
        ),
      ),
    );
    yield* provider.checkoutChangeRequest({
      cwd: "/repo",
      context: {
        provider: {
          kind: "github",
          name: "GitHub Enterprise",
          baseUrl: "https://github.example.test:8443",
        },
        remoteName: "review",
        remoteUrl:
          "https://user:secret@github.example.test:8443/team/project.git?token=secret#fragment",
      },
      reference: "42",
    });
    assert.equal(destination, "github.example.test:8443/team/project");
  }),
);

it("accepts active authenticated GitHub accounts when another account fails", () => {
  const auth = GitHubSourceControlProvider.discovery.parseAuth(
    processResult(
      JSON.stringify({
        hosts: {
          "github.com": [
            {
              state: "success",
              active: true,
              host: "github.com",
              login: "active-user",
              tokenSource: "keyring",
              gitProtocol: "ssh",
            },
            {
              state: "error",
              active: false,
              host: "github.com",
              login: "stale-user",
              tokenSource: "keyring",
              gitProtocol: "ssh",
              error: "The token in keyring is invalid.",
            },
          ],
        },
      }),
    ),
  );

  assert.deepStrictEqual(
    {
      status: auth.status,
      account: auth.account,
      host: auth.host,
    },
    {
      status: "authenticated",
      account: Option.some("active-user"),
      host: Option.some("github.com"),
    },
  );
});

it("parses GitHub auth JSON from stdout when stderr has warnings", () => {
  const auth = GitHubSourceControlProvider.discovery.parseAuth(
    processResult(
      JSON.stringify({
        hosts: {
          "github.com": [
            {
              state: "success",
              active: true,
              host: "github.com",
              login: "active-user",
              tokenSource: "keyring",
              gitProtocol: "ssh",
            },
          ],
        },
      }),
      { stderr: "warning: ignored diagnostic from gh\n" },
    ),
  );

  assert.deepStrictEqual(
    {
      status: auth.status,
      account: auth.account,
      host: auth.host,
    },
    {
      status: "authenticated",
      account: Option.some("active-user"),
      host: Option.some("github.com"),
    },
  );
});

it("parses GitHub auth status accounts by host and active state", () => {
  assert.deepStrictEqual(
    parseGitHubAuthStatus(
      JSON.stringify({
        hosts: {
          "github.com": [
            {
              state: "success",
              active: true,
              host: "github.com",
              login: "active-user",
              tokenSource: "keyring",
              gitProtocol: "ssh",
            },
            {
              state: "error",
              active: false,
              host: "github.com",
              login: "stale-user",
              tokenSource: "keyring",
              gitProtocol: "ssh",
            },
          ],
          "github.example.test": [
            {
              state: "success",
              active: false,
              host: "github.example.test",
              login: "enterprise-user",
              tokenSource: "keyring",
              gitProtocol: "ssh",
            },
          ],
        },
      }),
    ).accounts,
    [
      {
        host: "github.com",
        account: "active-user",
        authenticated: true,
        active: true,
        error: null,
      },
      {
        host: "github.com",
        account: "stale-user",
        authenticated: false,
        active: false,
        error: null,
      },
      {
        host: "github.example.test",
        account: "enterprise-user",
        authenticated: true,
        active: false,
        error: null,
      },
    ],
  );
});

it("reports unauthenticated when GitHub JSON has accounts but none are valid", () => {
  const auth = GitHubSourceControlProvider.discovery.parseAuth(
    processResult(
      JSON.stringify({
        hosts: {
          "github.com": [
            {
              state: "error",
              active: true,
              host: "github.com",
              login: "stale-user",
              tokenSource: "keyring",
              gitProtocol: "ssh",
              error: "The token in keyring is invalid.",
            },
          ],
        },
      }),
    ),
  );

  assert.deepStrictEqual(
    {
      status: auth.status,
      host: auth.host,
      detail: auth.detail,
    },
    {
      status: "unauthenticated",
      host: Option.some("github.com"),
      detail: Option.some("The token in keyring is invalid."),
    },
  );
});

it("reports an update hint instead of unauthenticated when gh predates --json", () => {
  const auth = GitHubSourceControlProvider.discovery.parseAuth(
    processResult("", {
      stderr: "unknown flag: --json\n\nUsage:  gh auth status [flags]\n",
      exitCode: ChildProcessSpawner.ExitCode(1),
    }),
  );

  assert.strictEqual(auth.status, "unknown");
  assert.match(
    Option.getOrElse(auth.detail, () => ""),
    /2\.81\.0/,
  );
});
