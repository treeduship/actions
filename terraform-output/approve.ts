import * as core from "@actions/core";
import { RequestError } from "@octokit/request-error";
import type { getOctokit } from "@actions/github";

// Snippet adapted from https://github.com/hmarr/auto-approve-action/blob/v2/src/approve.ts
export async function approve(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
  prNumber: number
) {
  try {
    core.debug(`Getting pull request #${prNumber} info`);
    const pull_request = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });
    const commit = pull_request.data.head.sha;

    core.debug(`Commit SHA is ${commit}`);

    core.debug(
      `Getting reviews for pull request #${prNumber} and commit ${commit}`
    );
    const reviews = await octokit.rest.pulls.listReviews({
      owner: owner,
      repo: repo,
      pull_number: prNumber,
    });

    for (const review of reviews.data) {
      if (
        review.user?.login == "github-actions[bot]" &&
        review.state == "CHANGES_REQUESTED"
      ) {
        core.info(
          `Current user already requested changes for pull request #${prNumber}, auto approving disabled for pr.`
        );
        return;
      }
      if (
        review.user?.login == "github-actions[bot]" &&
        review.commit_id == commit &&
        review.state == "APPROVED"
      ) {
        core.debug(
          `Current user already approved pull request #${prNumber}, nothing to do`
        );
        return;
      }
    }

    core.debug(
      `Pull request #${prNumber} has not been approved yet, creating approving review`
    );
    await octokit.rest.pulls.createReview({
      owner: owner,
      repo: repo,
      pull_number: prNumber,
      event: "APPROVE",
    });
    core.info(`Approved pull request #${prNumber}`);
  } catch (error) {
    if (error instanceof RequestError) {
      switch (error.status) {
        case 401:
          core.setFailed(
            `${error.message}. Please check that the \`github-token\` input ` +
              "parameter is set correctly."
          );
          break;
        case 403:
          core.setFailed(
            `${error.message}. In some cases, the GitHub token used for actions triggered ` +
              "from `pull_request` events are read-only, which can cause this problem. " +
              "Switching to the `pull_request_target` event typically resolves this issue."
          );
          break;
        case 404:
          core.setFailed(
            `${error.message}. This typically means the token you're using doesn't have ` +
              "access to this repository. Use the built-in `${{ secrets.GITHUB_TOKEN }}` token " +
              "or review the scopes assigned to your personal access token."
          );
          break;
        case 422:
          core.setFailed(
            `${error.message}. This typically happens when you try to approve the pull ` +
              "request with the same user account that created the pull request. Try using " +
              "the built-in `${{ secrets.GITHUB_TOKEN }}` token, or if you're using a personal " +
              "access token, use one that belongs to a dedicated bot account."
          );
          break;
        default:
          core.setFailed(`Error (code ${error.status}): ${error.message}`);
      }
      return;
    }

    if (error instanceof Error) {
      core.setFailed(error);
    } else {
      core.setFailed("Unknown error");
    }
    return;
  }
}

export async function requestChanges(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
  prNumber: number
) {
  try {
    core.debug(`Getting pull request #${prNumber} info`);
    const pull_request = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });
    const commit = pull_request.data.head.sha;

    core.debug(`Commit SHA is ${commit}`);

    core.info(
      `Getting reviews for pull request #${prNumber} and commit ${commit}`
    );
    const reviews = await octokit.rest.pulls.listReviews({
      owner: owner,
      repo: repo,
      pull_number: prNumber,
    });

    for (const review of reviews.data) {
      if (
        review.user?.login == "github-actions[bot]" &&
        review.commit_id == commit &&
        review.state == "CHANGES_REQUESTED"
      ) {
        core.debug(
          `Current user already requested changes for pull request #${prNumber}, nothing to do`
        );
        return;
      }
    }

    core.debug(
      `Pull request #${prNumber} has not been approved yet, creating approving review`
    );
    await octokit.rest.pulls.createReview({
      owner: owner,
      repo: repo,
      pull_number: prNumber,
      event: "REQUEST_CHANGES",
      body: "The plan for this PR wasn't clean. Rejecting changes. Review summary for more details.",
    });
    core.info(`Requested changes for pull request #${prNumber}`);
  } catch (error) {
    if (error instanceof RequestError) {
      switch (error.status) {
        case 401:
          core.setFailed(
            `${error.message}. Please check that the \`github-token\` input ` +
              "parameter is set correctly."
          );
          break;
        case 403:
          core.setFailed(
            `${error.message}. In some cases, the GitHub token used for actions triggered ` +
              "from `pull_request` events are read-only, which can cause this problem. " +
              "Switching to the `pull_request_target` event typically resolves this issue."
          );
          break;
        case 404:
          core.setFailed(
            `${error.message}. This typically means the token you're using doesn't have ` +
              "access to this repository. Use the built-in `${{ secrets.GITHUB_TOKEN }}` token " +
              "or review the scopes assigned to your personal access token."
          );
          break;
        case 422:
          core.setFailed(
            `${error.message}. This typically happens when you try to approve the pull ` +
              "request with the same user account that created the pull request. Try using " +
              "the built-in `${{ secrets.GITHUB_TOKEN }}` token, or if you're using a personal " +
              "access token, use one that belongs to a dedicated bot account."
          );
          break;
        default:
          core.setFailed(`Error (code ${error.status}): ${error.message}`);
      }
      return;
    }

    if (error instanceof Error) {
      core.setFailed(error);
    } else {
      core.setFailed("Unknown error");
    }
    return;
  }
}
