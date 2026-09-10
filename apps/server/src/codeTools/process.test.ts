import { expect, it } from "vite-plus/test";
import { runCommand } from "./process.ts";

it("keeps Node watch reporting out of tool subprocesses while preserving their environment", async () => {
  const result = await runCommand(
    process.execPath,
    [
      "-e",
      "process.stdout.write(JSON.stringify({watch:process.env.WATCH_REPORT_DEPENDENCIES,kept:process.env.T3_CODE_TOOL_TEST}))",
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, WATCH_REPORT_DEPENDENCIES: "1", T3_CODE_TOOL_TEST: "retained" },
    },
  );
  expect(JSON.parse(result)).toEqual({ kept: "retained" });
});
