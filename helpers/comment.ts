import { warning } from "@actions/core";
import { getOctokit } from "@actions/github";
import { RequestError } from "@octokit/request-error";

interface PRCommentOptions {
  octokit: ReturnType<typeof getOctokit>;
  owner: string;
  repo: string;
  prId: number;
  context: string;
  body: string;
}

export class TooLongError extends Error {
  constructor() {
    super("Issue body is too long.");
    this.name = "TooLongError";
  }
}

export async function createOrUpdatePRComment({
  owner,
  repo,
  prId,
  context,
  body,
  octokit,
}: PRCommentOptions) {
  const { data: comments } = await octokit.rest.issues.listComments({
    issue_number: prId,
    owner,
    repo,
  });

  const commentId = `uShipActionID: ${context}`;
  const comment = comments.find((comment) => {
    return comment.body?.includes(commentId);
  });

  body = `<!-- ${commentId} -->\n\n` + body;

  try {
    if (comment) {
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: comment.id,
        body,
      });
    } else {
      await octokit.rest.issues.createComment({
        issue_number: prId,
        owner,
        repo,
        body,
      });
    }
  } catch (e: unknown) {
    if (e && typeof e == "object" && "message" in e) {
      const message = (e as any).message as string;
      if (
        message.includes("Validation Failed") &&
        message.includes("body is too long")
      ) {
        throw new TooLongError();
      }
    }
  }
}
