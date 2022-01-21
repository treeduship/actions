import { getInput, setSecret, exportVariable, setOutput } from "@actions/core";
import { SSM } from "@aws-sdk/client-ssm";
import { SecretsManager } from "@aws-sdk/client-secrets-manager";
import { FAILSAFE_SCHEMA, load } from "js-yaml";
import { readFile } from "fs/promises";
import Ajv from "ajv";
import { JSONPath } from "jsonpath-plus";
import schema from "./schema.json";

export type Secret = (
  | {
      ssm: string;
    }
  | {
      secretsManager: string;
    }
) & {
  jsonpath?: string;
  allowEmpty?: boolean;
  options?: { region: string };
};

export interface Secrets {
  [key: string]: string | Secret;
}

export type SecretsDefinition = {
  environments?: { [key: string]: Secrets };
} & Secrets;

const ajv = new Ajv();
const validator = await ajv.compileAsync<SecretsDefinition>(schema);
const ssm = new SSM({});
const secretsManager = new SecretsManager({});

let secretsYaml = getInput("secrets");
const secretsFile = getInput("secrets-file");
const failIfEmpty = getInput("fail-if-empty");
const environment = getInput("environment");

if (!secretsYaml && !secretsFile) {
  console.warn(`Neither 'secrets' no 'secrets-file' specified.`);
  throw new Error("You must provide one of 'secrets' or 'secrets-file'.");
}

if (!secretsYaml) {
  console.info(
    `No inline secrets specified, loading ${
      secretsFile ?? ".github/aws-secrets.yml"
    }.`
  );

  // If there's no secretsFile, speculatively load .github/aws-secrets.yml.
  if (!secretsFile) {
    try {
      secretsYaml = (await readFile(".github/aws-secrets.yml")).toString();
    } catch {
      // Fail unconditionally if `fail-if-empty` is specified any value.
      if (!!failIfEmpty) {
        throw new Error("No secrets file or secrets found.");
      } else {
        console.info("No secrets file found, skipping.");
        process.exit(0);
      }
    }
  } else {
    secretsYaml = (await readFile(secretsFile)).toString();
  }
}

const parsedSecrets = load(secretsYaml, {
  filename: secretsFile,
  schema: FAILSAFE_SCHEMA,
  json: true,
});
const valid = validator(parsedSecrets);
if (!valid) {
  throw new Error(`Invalid secrets provided: ${validator.errors}`);
}

const { environments, ...secrets } = parsedSecrets;

const loadParameter = async (
  key: string,
  Name: string,
  options?: { region?: string }
) => {
  console.info(
    `Retrieving value for '${key}' from Systems Manager Parameter Store '${Name}'`
  );

  let client = ssm;
  if (!!options) {
    client = new SSM(options);
  }

  const parameter = await client.getParameter({ Name, WithDecryption: true });
  if (!parameter.Parameter) {
    throw new Error(`Failed to get parameter '${Name}'.`);
  }
  return parameter.Parameter.Value!;
};

const loadSecret = async (
  key: string,
  SecretId: string,
  options?: { region?: string }
) => {
  console.info(
    `Retrieving value for '${key}' from Secrets Manager '${SecretId}'`
  );

  let client = secretsManager;
  if (!!options) {
    client = new SecretsManager(options);
  }

  const secretsValue = await client.getSecretValue({ SecretId });
  if (!!secretsValue.SecretBinary && !secretsValue.SecretString) {
    throw new Error(
      `Secrets Manager values must be string values. Failed to read ${key}.`
    );
  }
  return secretsValue.SecretString!;
};

const loadAndSetSecret = async (
  key: string,
  type: "ssm" | "secretsManager",
  id: string,
  jsonpath?: string,
  allowEmpty?: boolean,
  options?: { region?: string }
) => {
  let secretValue: string;
  switch (type) {
    case "ssm":
      secretValue = await loadParameter(key, id, options);
      break;
    case "secretsManager":
      secretValue = await loadSecret(key, id, options);
      break;
    default:
      throw new Error(`Unknown secret store type: ${type}.`);
  }

  if (!secretValue?.trim()) {
    if (failIfEmpty === "true" && allowEmpty !== true) {
      throw new Error(`Got empty response for ${key}.`);
    } else {
      console.warn(`Got empty response for ${key}. Skipping.`);
    }
    return;
  }

  if (jsonpath) {
    const parsedSecret = load(secretValue, {
      schema: FAILSAFE_SCHEMA,
      json: true,
    });
    const resolvedValue = JSONPath({
      path: jsonpath,
      json: parsedSecret as any,
      wrap: false,
      preventEval: true,
    });
    if (!resolvedValue) {
      if (failIfEmpty === "true") {
        throw new Error(
          `Got empty value from jsonpath for ${key}. Resolved ${jsonpath} for ${key}.`
        );
      } else {
        console.warn(
          `Got empty value from jsonpath for ${key}. Resolved ${jsonpath} for ${key}. Skipping.`
        );
      }
      return;
    }

    const stringified = JSON.stringify(resolvedValue);
    setSecret(stringified);
    exportVariable(key, stringified);
    setOutput(key, stringified);
  } else {
    setSecret(secretValue);
    exportVariable(key, secretValue);
    setOutput(key, secretValue);
  }
};

const loadAndSetSecrets = async (secrets: Secrets) => {
  const keys = Object.keys(secrets) as (keyof Secret)[];
  for (const key of keys) {
    console.info(`Reading Secret: ${key}`);
    const secret = secrets[key];
    if (!secret) {
      throw new Error(`You must provide a value for ${key}.`);
    }

    if (typeof secret === "string") {
      const { protocol, pathname, searchParams } = new URL(secret);
      if (protocol === "ssm:") {
        await loadAndSetSecret(
          key,
          "ssm",
          pathname,
          undefined,
          false,
          Object.fromEntries(searchParams)
        );
      } else if (protocol === "secrets-manager:") {
        await loadAndSetSecret(
          key,
          "secretsManager",
          pathname,
          undefined,
          false,
          Object.fromEntries(searchParams)
        );
      } else {
        throw new Error(
          `Got invalid value for ${key}. If using string values, the path/arn must be prefixed with ssm: or secrets-manager:. Unknown value ${protocol}.`
        );
      }
    } else {
      if ("ssm" in secret && !!secret.ssm) {
        await loadAndSetSecret(
          key,
          "ssm",
          secret.ssm,
          secret.jsonpath,
          secret.allowEmpty,
          secret.options
        );
      } else if ("secretsManager" in secret && !!secret.secretsManager) {
        await loadAndSetSecret(
          key,
          "secretsManager",
          secret.secretsManager,
          secret.jsonpath,
          secret.allowEmpty,
          secret.options
        );
      } else {
        throw new Error(
          `You must provide one of 'ssm' or 'secretsManager' for ${key}.`
        );
      }
    }
  }
};

await loadAndSetSecrets(secrets);

if (!!environments && !!environments[environment]) {
  await loadAndSetSecrets(environments[environment]);
}
