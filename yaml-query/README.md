# yaml-query-gha

A Github Action for querying a yaml file. Extracted values can be used to populate environment variables, etc.

## Inputs

### `path`

**Required** The path to the yaml file to be query.

### `query`

**Required** A dot-notation query of the yaml file (e.g. `prop.array.0.subProp`).

### `env-key`

**Required** The key of the environment variable to populate with the value extracted from the yaml file.

## Example usage

```yaml
uses: uShip/actions/yaml-query@v1
with:
  yaml-path: ./serverless.yml
  yaml-query: service
  env-key: SERVICE_NAME
```
