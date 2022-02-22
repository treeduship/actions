# `uShip/actions/setup-aws`

This action assists in authenticating a workflow with AWS using OIDC Auth.

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
