import { TooLongError } from "./../helpers/comment";
import "source-map-support/register";
import {
  getInput,
  setFailed,
  warning,
  summary as summaryBuilder,
} from "@actions/core";
import { getOctokit } from "@actions/github";
import { createOrUpdatePRComment } from "@uship/actions-helpers/comment";
import { default as stripAnsi } from "strip-ansi";
import split2 from "split2";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import type { SummaryTableRow } from "@actions/core/lib/summary";

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
): Promise<{ rows: SummaryTableRow[]; stdout: string; stderr: string }> {
  let rows: SummaryTableRow[] = [];
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
        rows.push([stepName, `${countText}${hasWarnings ? "*" : ""}`]);
      } else {
        rows.push([stepName, `💬${hasWarnings ? "*" : ""}`]);
      }
    } else {
      rows.push([stepName, `➖${hasWarnings ? "*" : ""}`]);
    }
  } else {
    rows.push([stepName, `${result?.outcome == "success" ? "✔" : "✖"}`]);
  }

  if (result?.outcome == "success") {
    stdout += stripAnsi(result.outputs?.stdout ?? "");
  }

  if (result?.outcome === "failure") {
    stderr += stripAnsi(result.outputs?.stderr ?? "");
  }

  return {
    rows,
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
): Promise<{ rows: SummaryTableRow[]; stdout: string; stderr: string }> {
  if (!existsSync(logName)) {
    if (
      result?.outcome &&
      result?.outcome !== "failure" &&
      !["init", "fmt", "validate", "show"].includes(stepName)
    ) {
      warning(`Failed to read log file ${logName} for step ${stepName}.`);
      return {
        rows: [[stepName, "❌"]],
        stdout: "",
        stderr:
          "Failed to read log file. Refer to step output in Workflow logs.",
      };
    }

    let resultIcon: string;
    switch (result?.outcome) {
      case "failure":
        resultIcon = "❌";
        break;
      case "success":
        resultIcon = "✔️";
        break;
      default:
        resultIcon = "-";
        break;
    }
    return {
      rows: [[stepName, resultIcon]],
      stdout: "",
      stderr: "",
    };
  }

  let rows: SummaryTableRow[] = [];
  let stdout: string[] = [];
  let stderr: string[] = [];
  switch (stepName) {
    case "plan":
      {
        let hasWarnings = false;
        const logStream = createReadStream(logName).pipe(split2());
        for await (const logLine of logStream) {
          if (((logLine as string) ?? "").trim() === "") {
            continue;
          }

          if (!(logLine as string).startsWith("{")) {
            if (
              !["Releasing state lock"].some((exemptLine) =>
                (logLine as string).includes(exemptLine)
              )
            ) {
              warning(
                `Assuming non-JSON line from log file ${logName} is error.\n${logLine}.`
              );
            }
            stderr.push(logLine);
            continue;
          }

          let log: TerraformUiJson;
          try {
            log = JSON.parse(logLine);
          } catch (e) {
            throw new Error(`Failed to parse log lines for ${logName}. ${e}`);
          }

          if (log["@level"] == "error") {
            stderr.push(log["@message"]);
          } else {
            stdout.push(`${log["@level"]}: ${log["@message"]}`);
          }

          if (log["@level"] === "warning" || log.type === "resource_drift") {
            hasWarnings = true;
          }

          switch (log.type) {
            case "change_summary":
              {
                const { add, change, remove } = log.changes;
                if (add + change + remove === 0) {
                  rows.push([stepName, `➖${hasWarnings ? "*" : ""}`]);
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
                rows.push([stepName, `${countText}${hasWarnings ? "*" : ""}`]);
              }
              break;
          }
        }
      }
      break;
    case "show":
      {
        const logContents = (await readFile(logName)).toString();
        stdout.push(`
## plan

\`\`\`
${stripAnsi(logContents)}
\`\`\`
`);
      }
      break;
  }

  if (result?.output === "failure") {
    return {
      rows: [[stepName, "❌"]],
      stdout: stdout.join("\n"),
      stderr: stderr.join("\n"),
    };
  }

  return {
    rows,
    stdout: stdout.join("\n"),
    stderr: stderr.join("\n"),
  };
}

async function run() {
  try {
    const cwd = getInput("working-directory") ?? "./";
    const readJson = getInput("json") === "true";
    const token = getInput("token", { required: true });
    const octokit = getOctokit(token);

    const stepInput = getInput("steps");
    const stepFile = getInput("steps-file");
    if (!stepInput && !stepFile) {
      throw new Error("You must provide one of steps or steps-file as input.");
    }

    let steps: any;
    if (!!stepInput) {
      steps = JSON.parse(stepInput);
    } else {
      let filePath = resolve(cwd, stepFile);
      if (!existsSync(filePath)) {
        throw new Error(`Unable to find encoded steps file at ${filePath}`);
      }
      const contents = readFileSync(filePath).toString();
      steps = JSON.parse(contents);
    }

    const tfSteps = new Map<string, TfStep | undefined>([
      ["init", steps[getInput("init") || "init"]],
      ["fmt", steps[getInput("fmt") || "fmt"]],
      ["validate", steps[getInput("validate") || "validate"]],
      ["plan", steps[getInput("plan") || "plan"]],
      ["show", steps[getInput("show") || "show"]],
    ]);

    const contextId = getInput("context");

    const now = new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "long",
      timeZone: "America/Chicago",
    } as any).format(new Date());

    const summary = summaryBuilder.addHeading(
      `Terraform Output${contextId ? ` for ${contextId}` : ""}`,
      2
    );

    const stepTable: SummaryTableRow[] = [
      [
        { data: "cmd", header: true },
        { data: "result", header: true },
      ],
    ];

    let errorMessage = "";
    const stepResults = new Map<string, { stdout: string; stderr: string }>();
    for (const [name, result] of tfSteps) {
      // Skip missing non-plan steps in output.
      if (name !== "plan" && !result) {
        continue;
      }

      const { rows, stdout, stderr } = readJson
        ? await parseLog(name, result, resolve(cwd, `${name}.log`))
        : await parseStdout(name, result);
      stepTable.push(...rows);
      stepResults.set(name, { stdout, stderr });
      errorMessage += stderr + "\n";
    }

    summary.addTable(stepTable);

    const planStep = stepResults.get("plan");
    const showStep = stepResults.get("show");

    let errorMd = "";
    if (errorMessage?.trim() !== "") {
      errorMd = `
## stderr:

\`\`\`
${errorMessage?.trim() || "N/A"}
\`\`\`\n`;
    }

    summary.addDetails(
      "<b>Plan Output</b>",
      `
${showStep?.stdout}
## stdout:

\`\`\`
${
  planStep?.stdout.trim() ||
  "No plan logs available. Check stderr or workflow logs."
}
\`\`\`

${errorMd}`
    );

    summary
      .addEOL()
      .addRaw(
        `*Pusher: @${process.env.GITHUB_ACTOR}, Action: \`${process.env.GITHUB_EVENT_NAME}\`, [Workflow: \`${process.env.GITHUB_WORKFLOW}\`](https://github.com/${process.env.GITHUB_REPOSITORY}/runs/${process.env.GITHUB_RUN_ID})*;`,
        true
      )
      .addEOL()
      .addSeparator()
      .addEOL()
      .addRaw(`<sup>Last Updated: ${now}</sup>`);

    const body = summary.stringify();
    await summary.write();

    const [owner, repo] = process.env.GITHUB_REPOSITORY!.split("/");
    const prId = Number.parseInt(getInput("pr-id", { required: true }), 10);

    const context = `terraform-output${contextId}`;
    try {
      await createOrUpdatePRComment({
        owner,
        repo,
        prId,
        context,
        body,
        octokit,
      });
    } catch (e) {
      if (e instanceof TooLongError) {
        const fallbackBody = summaryBuilder
          .addHeading(
            `Terraform Output${contextId ? ` for ${contextId}` : ""}`,
            2
          )
          .addTable(stepTable)
          .addEOL()
          .addRaw(
            `Some of the output of this terraform run was too long to store in comment. Review Workflow logs for more details or plan contents.`,
            true
          )
          .addEOL()
          .addRaw(
            `*Pusher: @${process.env.GITHUB_ACTOR}, Action: \`${process.env.GITHUB_EVENT_NAME}\`, [Workflow: \`${process.env.GITHUB_WORKFLOW}\`](https://github.com/${process.env.GITHUB_REPOSITORY}/runs/${process.env.GITHUB_RUN_ID})*;`,
            true
          )
          .addEOL()
          .addSeparator()
          .addEOL()
          .addRaw(`<sup>Last Updated: ${now}</sup>`)
          .stringify();

        await createOrUpdatePRComment({
          owner,
          repo,
          prId,
          context,
          body: fallbackBody,
          octokit,
        });
      }
    }

    if (getInput("fail-on-error").toLowerCase() === "true") {
      tfSteps.forEach((result, name) => {
        if (result && result.outcome === "failure") {
          setFailed(
            `Terraform step "${name}" failed. Err: ${
              errorMessage ?? "Unavailable."
            }`
          );
        }
      });
    }
  } catch (e) {
    setFailed(e as Error);
  }
}

run();
