import "source-map-support/register";
import { getInput, setFailed, warning } from "@actions/core";
import { getOctokit } from "@actions/github";
import { createOrUpdatePRComment } from "@uship/actions-helpers/comment";
import { default as stripAnsi } from "strip-ansi";
import { createReadStream, existsSync } from "node:fs";
import { resolve } from "node:path";
import split2 from "split2";

interface TfStep {
  outcome: "success" | "failure";
  outputs?: {
    exitcode: number;
    stdout: string;
    stderr: string;
  };
}

async function parseStdout(
  stepName: string,
  result?: any
): Promise<{ table: string; stdout: string; stderr: string }> {
  let table = "";
  let stdout = "";
  let stderr = "";
  if (stepName === "plan" && result?.outcome == "success") {
    const noAscii = stripAnsi(result.outputs!.stdout);
    const hasChanges = !noAscii.includes(
      "No changes. Infrastructure is up-to-date."
    );
    const hasWarnings = noAscii.includes("Warning");
    if (hasChanges) {
      const counts =
        /Plan: (?<add>\d+) to add, (?<change>\d+) to change, (?<destroy>\d+) to destroy/.exec(
          noAscii
        );
      if (counts) {
        const { add, change, destroy } = counts.groups!;
        const countText = (
          [
            ["+", Number.parseInt(add, 10)],
            ["~", Number.parseInt(change, 10)],
            ["-", Number.parseInt(destroy, 10)],
          ] as const
        )
          .filter(([_, count]) => count > 0)
          .map(([icon, count]) => `${icon}${count}`)
          .join(", ");
        table += `\n| \`${stepName}\` | ${countText}${
          hasWarnings ? "*" : ""
        } |`;
      } else {
        table += `\n| \`${stepName}\` | 💬${hasWarnings ? "*" : ""} |`;
      }
    } else {
      table += `\n| \`${stepName}\` | ➖${hasWarnings ? "*" : ""} |`;
    }
  } else {
    table += `\n| \`${stepName}\` |  ${
      result?.outcome == "success" ? "✔" : "✖"
    }   |`;
  }

  if (stepName !== "plan" && result?.outcome == "success") {
    stdout += stripAnsi(result.outputs?.stdout ?? "");
  }

  if (result?.outcome === "failure") {
    stderr += stripAnsi(result.outputs?.stderr ?? "");
  }

  return {
    table,
    stdout,
    stderr,
  };
}

interface TerraformUiJsonBase {
  ["@level"]: string;
  ["@message"]: string;
  ["@module"]: string;
  ["@timestamp"]: string;
  ["type"]: string;
}

interface TerraformChangeSummaryJson extends TerraformUiJsonBase {
  type: "change_summary";
  changes: {
    add: number;
    change: number;
    remove: number;
    operation: string;
  };
}

interface TerraformDriftJson extends TerraformUiJsonBase {
  type: "resource_drift";
}

interface TerraformOutputsJson extends TerraformUiJsonBase {
  type: "outputs";
  outputs: { [key: string]: any };
}

type TerraformUiJson =
  | TerraformOutputsJson
  | TerraformChangeSummaryJson
  | TerraformDriftJson;

async function parseLog(
  stepName: string,
  result: any,
  logName: string
): Promise<{ table: string; stdout: string; stderr: string }> {
  if (!existsSync(logName)) {
    if (
      result?.outcome &&
      result?.outcome !== "failure" &&
      !["init", "fmt", "validate"].includes(stepName)
    ) {
      warning(`Failed to read log file ${logName} for step ${stepName}.`);
      return {
        table: `\n| \`${stepName}\` | ❌ |`,
        stdout: "",
        stderr:
          "Failed to read log file. Refer to step output in Workflow logs.",
      };
    }
    return {
      table: `\n| \`${stepName}\` | ${
        result?.outcome === "failure" ? "❌" : "-"
      } |`,
      stdout: "",
      stderr: "",
    };
  }

  // TODO: Validate has it's whole own JSON output format, support that.
  let table = "";
  let stdout: string[] = [];
  let stderr: string[] = [];
  let hasWarnings = false;
  const logStream = createReadStream(logName).pipe(split2());
  for await (const logLine of logStream) {
    if (((logLine as string) ?? "").trim() === "") {
      continue;
    }

    if (!(logLine as string).startsWith("{")) {
      warning(
        `Assuming non-JSON line from log file ${logName} is error.\n${logLine}.`
      );
      stderr.push(logLine);
      continue;
    }

    let log: TerraformUiJson;
    try {
      log = JSON.parse(logLine);
    } catch (e) {
      throw new Error(`Failed to parse log lines for ${logName}. ${e}`);
    }

    if (log["@level"] !== "error") {
      stdout.push(log["@message"]);
    } else {
      stderr.push(log["@message"]);
    }

    if (log["@level"] === "warning" || log.type === "resource_drift") {
      hasWarnings = true;
    }

    switch (log.type) {
      case "change_summary":
        {
          const { add, change, remove } = log.changes;
          if (add + change + remove === 0) {
            table += `\n| \`${stepName}\` | ➖${hasWarnings ? "*" : ""} |`;
            continue;
          }

          const countText = (
            [
              ["+", add],
              ["~", change],
              ["-", remove],
            ] as const
          )
            .filter(([_, count]) => count > 0)
            .map(([icon, count]) => `${icon}${count}`)
            .join(", ");
          table += `\n| \`${stepName}\` | ${countText}${
            hasWarnings ? "*" : ""
          } |`;
        }
        break;
    }
  }

  if (result?.output === "failure") {
    return {
      table: `\n| \`${stepName}\` | ❌ |`,
      stdout: stdout.join("\n"),
      stderr: stderr.join("\n"),
    };
  }

  return {
    table,
    stdout: stdout.join("\n"),
    stderr: stderr.join("\n"),
  };
}

async function run() {
  try {
    const readJson = getInput("json") === "true";
    const token = getInput("token", { required: true });
    const octokit = getOctokit(token);

    const steps = JSON.parse(getInput("steps", { required: true }));

    const tfSteps = new Map<string, TfStep | undefined>([
      ["fmt", steps[getInput("fmt") || "fmt"]],
      ["init", steps[getInput("init") || "init"]],
      ["validate", steps[getInput("validate") || "validate"]],
      ["plan", steps[getInput("plan") || "plan"]],
    ]);

    const contextId = getInput("context");
    const cwd = getInput("working-directory") ?? "./";

    const now = new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "long",
      timeZone: "America/Chicago",
    } as any).format(new Date());

    let stepTable = `
| cmd | result |
|----|----|`;

    let planOut = "";
    let error = "";
    const stepResults = new Map<string, { stdout: string; stderr: string }>();
    for (const [name, result] of tfSteps) {
      const { table, stdout, stderr } = readJson
        ? await parseLog(name, result, resolve(cwd, `${name}.log`))
        : await parseStdout(name, result);
      stepTable += table;
      stepResults.set(name, { stdout, stderr });
      error += stderr + "\n";
      if (name === "plan") {
        planOut = stdout;
      }
    }

    const planStep = stepResults.get("plan");

    let errorMd = "";
    if (error?.trim() !== "") {
      errorMd = `
stderr:
\`\`\`
${planStep?.stderr.trim() || "N/A"}
\`\`\``;
    }

    const body = `
## Terraform Output${contextId ? ` for ${contextId}` : ""}
${stepTable}

<details><summary><b>Plan Output</b></summary>

\`\`\`${planOut ?? "\n-\n"}\`\`\`
${errorMd}
</details>

*Pusher: @${process.env.GITHUB_ACTOR}, Action: \`${
      process.env.GITHUB_EVENT_NAME
    }\`, Workflow: \`${process.env.GITHUB_WORKFLOW}\`*;

--------------
<sup>Last Updated: ${now}</sup>`;

    const [owner, repo] = process.env.GITHUB_REPOSITORY!.split("/");
    const prId = Number.parseInt(getInput("pr-id", { required: true }), 10);

    const context = `terraform-output${contextId}`;
    await createOrUpdatePRComment({
      owner,
      repo,
      prId,
      context,
      body,
      octokit,
    });

    if (getInput("fail-on-error").toLowerCase() === "true") {
      tfSteps.forEach((result, name) => {
        if (result && result.outcome === "failure") {
          setFailed(
            `Terraform step "${name}" failed. Err: ${error ?? "Unavailable."}`
          );
        }
      });
    }
  } catch (e) {
    setFailed(e as Error);
  }
}

run();
