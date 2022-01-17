# `uShip/actions/aws-secrets`

This action assists in loading and setting secrets from AWS Systems Manager Parameter Store and AWS Secrets Manager.

```yml
      - uses: uShip/actions/aws-secrets@v1
        with:
          # Inline secrets file. Read below for the full format
          secrets: |
            SECRET_SSM: ssm:my-secret
            SECRET_SECRETS_MANAGER: secrets-manager:MyAwesomeAppSecret # Or the full arn
            SECRET_SSM_2:
              ssm: my-secret/my-value
            SECRET_SECRETS_MANAGER_2:
              secretsManager: MyAwesomeSecretValue
            SECRET_JSON:
              # Either SSM or Secrets Manager works here
              # ssm: my-secret/my-json
              secretsManager: MyAwesomeSecretJson
              # Parse value as JSON and uses https://www.npmjs.com/package/jsonpath-plus to resolve the value.
              jsonpath: $.password
          # Path to secrets file. Read below for the full format. Defaults to: .github/aws-secrets.yml
          # secrets-file: secrets.yml

          # The environment to resolve. See below for more details:
          # environment: dev

          # If set to 'true', fails the action if a value is returned or resolved, but it's empty.
          # fail-if-empty: false
```

## Secrets File

You can specify what secrets to load using the following format:

```yaml
# <KEY> is what defines the environment variable name and output name.

# The short form prefixes the Name, Id, or ARN with a protocol value specifying where to load the secret from.
<KEY>: ssm:<Name> # or secrets-manager:<Id or full ARN>

# The long form specifies where to load from, as well as optionally allows specifying a jsonpath.
<KEY>:
  ssm: <Name>
  # secretsManager: <Id or ARN>
  
  # If set, parses the returned value as JSON (or YAML) and then resolves the output using JSONPath as defined by https://www.npmjs.com/package/jsonpath-plus.
  # jsonpath:

# If this key and the input `environment` are specified, this action will load all the secrets specified in environments[input.environment].
# Useful if you're using GitHub Action's environments feature and only want to load certain secrets in certain environments.
# environments:
#   <KEY>: 
```

## Using environments

When using GitHub Actions environments, you might only want to load certain secrets for certain environments. For that, you can using the `secrets-file` in combination with the `environment` variable.

```yaml
# .github/aws-secrets.yml
GENERAL_SECRET: secrets-manager:SomeSecret

environments:
  dev:
    COOL_SECRET: ssm:cool-secret
  prod:
    COOL_SECRET: secrets-manager:MySuperSecureSecret
    MY_OTHER_SECRET:
      ssm: /my/optional/secret
      jsonpath: $.key
      allowEmpty: true
```

```yaml
# .github/workflows/my-cool-workflow.yml
# ...
    - uses: uShip/actions/aws-secrets@v1
      with:
        environment: dev
        fail-if-empty: true

# env.GENERAL_SECRET -> *****
# env.COOL_SECRET -> *****

# ...
    - uses: uShip/actions/aws-secrets@v1
      with:
        environment: prod
        fail-if-empty: true

# env.GENERAL_SECRET -> *****
# env.COOL_SECRET -> *****
# env.MY_OTHER_SECRET -> *****
```
