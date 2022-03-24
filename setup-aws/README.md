# `uShip/actions/setup-aws`

Very often, GitHub Workflows needs to deploy cloud resources to AWS. Either for serverless pipelines or otherwise. This action simplifies authenticating GitHub Workflows with AWS using the recently introduced [OIDC Support](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect) and AWS's own [credentials action](https://github.com/aws-actions/configure-aws-credentials).

## Getting Started

Any Workflow using this action first needs to grant the workflow a set of "permissions" saying it's allowed to mint an authentication token for authentication with AWS and other services.

```yml
permissions:
  contents: read
  id-token: write
```

The above does two things:
* Grants the Workflow permission to read the Repositories contents
* Grants the Workflow permission to "write" or create an `id-token` which will be consumed by this action implicitly

_**IMPORTANT**: When you use `permissions`, it will cause all other non-specified permissions to be `none` by default. If your workflow does an action like commenting on a Pull Request or creating an issue, review the [permissions documentation](https://docs.github.com/en/actions/using-jobs/assigning-permissions-to-jobs) to ensure that you have assigned the correct permissions._

Then, in the `steps` for the job doing AWS operations add:

```yml     
      - uses: uShip/actions/setup-aws@v1
        with:
          accounts: ${{ secrets.AWS_ACCOUNTS }}
          env: dev
```

This action under the covers calls `aws-actions/configure-aws-credentials` with the correct role and information to authenticate for the environment specified in `env` with the default minimal role meant for basic serverless pipelines.

With this, any following steps should now be authenticated with AWS! To authenticate with other accounts, simply change the value of `env` to the desired account.

## Reference

```yml
permissions:
  # Gives the workflow permission to mint an OIDC token.
  id-token: write
  # If you don't at least specify this, the workflow won't have permission
  # to checkout the repository.
  contents: read 
  # ... any other permissions you may need, see https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#permissions ... #

# ...
      # Used in place of aws-actions/configure-aws-credentials
      - uses: uShip/actions/setup-aws@v1
        with:
          # A JSON-encoded dictionary with all the available "environments",
          # and their names and IDs. Used to avoid hard coding ids and names.
          accounts: ${{ secrets.AWS_ACCOUNTS }}

          # The target environment.
          # Defaults to dev
          # Options are dev, qa, sand, prod
          # env: dev

          # The target region
          # Defaults to us-east-1
          # region: us-east-1

          # The name of the repository's role. Assumes using a custom generated
          # role via the `iam-bootstrap` module of the base infrastructure repo.
          # Defaults to `all`, the catch-all least-privilege role.
          # repo: all

          # The name of the specific deployer role for a given repo. See `repo`
          # for more details.
          # Defaults to `gha`, the catch-all least-privilege role.
          # repo: gha
```
