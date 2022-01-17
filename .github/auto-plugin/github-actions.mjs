// @ts-check
import { setOutput } from "@actions/core";
import { parse } from "semver";

export default class LatestTagPlugin {
  constructor() {
    this.name = "github-actions";
  }
  /**
   * Tap into auto plugin points.
   * @param {import('@auto-it/core').default} auto
   */
  apply(auto) {
    auto.hooks.afterRelease.tapPromise(
      "github-actions",
      async ({ lastRelease, newVersion, releaseNotes }) => {
        setOutput("hasNewRelease", true);
        setOutput("lastRelease", lastRelease);
        setOutput("newVersion", newVersion);
        setOutput("releaseNotes", releaseNotes);

        const parsedVersion = parse(newVersion);
        setOutput("newMajorVersion", parsedVersion.major);
      }
    );
  }
}
